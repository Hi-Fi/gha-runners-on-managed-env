import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsRegion } from '@cdktf/provider-aws/lib/data-aws-region';
import { EcrRepository } from '@cdktf/provider-aws/lib/ecr-repository';
import { EcsCluster } from '@cdktf/provider-aws/lib/ecs-cluster';
import { EcsTaskDefinition } from '@cdktf/provider-aws/lib/ecs-task-definition';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { Fn, TerraformStack, TerraformVariable } from 'cdktf';
import { Construct } from 'constructs';


export class Aws extends TerraformStack {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        new AwsProvider(this, 'aws', {

        });

        const identity = new DataAwsCallerIdentity(this, 'Identity', {});

        const region = new DataAwsRegion(this, 'Region', {})

        const pat = new TerraformVariable(this, 'PAT', {
            description: 'Github PAT with Actions:Read and Admin:Read+Write scopes',
            nullable: false,
            sensitive: true
        })

        const cluster = new EcsCluster(this, 'Cluster', {
            name: 'gha-runner-cluster',
        });

        const runnerRole = new IamRole(this, 'RunnerRole', {
            assumeRolePolicy: Fn.jsonencode({
                'Version': '2012-10-17',
                'Statement': [
                    {
                        'Effect': 'Allow',
                        'Principal': {
                            'Service': 'ecs-tasks.amazonaws.com'
                        },
                        'Action': 'sts:AssumeRole'
                    }
                ]
            })
        })

        const runnerEcr = new EcrRepository(this, 'RunnerRepository', {
            name: 'gha'
        });

        const kanikoEcr = new EcrRepository(this, 'KanikoRepository', {
            name: 'kaniko'
        });

        const resultsEcr = new EcrRepository(this, 'ResultsRepository', {
            name: 'results'
        });

        const kanikoRole = new IamRole(this, 'KanikoRole', {
            assumeRolePolicy: Fn.jsonencode({
                'Version': '2012-10-17',
                'Statement': [
                    {
                        'Effect': 'Allow',
                        'Principal': {
                            'Service': 'ecs-tasks.amazonaws.com'
                        },
                        'Action': 'sts:AssumeRole'
                    }
                ]
            }),
            managedPolicyArns: [
                'arn:aws:iam::aws:policy/EC2InstanceProfileForImageBuilderECRContainerBuilds'
            ]
        })

        const ecsTaskExecutionRole = new IamRole(this, 'TaskExecutionRole', {
            assumeRolePolicy: Fn.jsonencode({
                'Version': '2012-10-17',
                'Statement': [
                    {
                        'Effect': 'Allow',
                        'Principal': {
                            'Service': 'ecs-tasks.amazonaws.com'
                        },
                        'Action': 'sts:AssumeRole'
                    }
                ]
            }),
            managedPolicyArns: [
                'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'
            ]
        })

        const runnerLogGroup = new CloudwatchLogGroup(this, 'RunnerLogGroup', {
            name: '/ecs/GHA',
        });

        const kanikoLogGroup = new CloudwatchLogGroup(this, 'KanikoLogGroup', {
            name: '/ecs/Kaniko',
        });

        new EcsTaskDefinition(this, 'RunnerTaskDefinition', {
            family: 'GHA',
            taskRoleArn: runnerRole.arn,
            executionRoleArn: ecsTaskExecutionRole.arn,
            containerDefinitions: Fn.jsonencode([
                {
                    name: 'runner',
                    image: `${runnerEcr.repositoryUrl}:latest`,
                    essential: true,
                    environment: [
                        {
                            name: 'GH_URL',
                            value: 'https://github.com/Hi-Fi/gha-runners-on-managed-env'
                        },
                        {
                            name: 'REGISTRATION_TOKEN_API_URL',
                            value: 'https://api.github.com/repos/Hi-Fi/gha-runners-on-managed-env/actions/runners/registration-token'
                        },
                        {
                            name: 'GITHUB_PAT',
                            value: pat.value
                        }
                    ],
                    logConfiguration: {
                        logDriver: 'awslogs',
                        options: {
                            "awslogs-group": runnerLogGroup.name,
                            "awslogs-region": region.name,
                            "awslogs-stream-prefix": "ecs",
                        }
                    }
                }
            ]),
            cpu: '1024',
            memory: '2048',
            requiresCompatibilities: [
                'FARGATE'
            ],
            runtimePlatform: {
                cpuArchitecture: 'X86_64',
                operatingSystemFamily: 'LINUX'
            },
            networkMode: 'awsvpc',
        })

        const kanikoTaskDefinition = new EcsTaskDefinition(this, 'KanikoTaskDefinition', {
            family: 'Kaniko',
            taskRoleArn: kanikoRole.arn,
            executionRoleArn: ecsTaskExecutionRole.arn,
            containerDefinitions: Fn.jsonencode([
                {
                    name: 'kaniko',
                    image: `${kanikoEcr.repositoryUrl}:latest`,
                    essential: true,
                    command: [
                        '--dockerfile=images/Dockerfile.gha',
                        '--context=git://github.com/Hi-Fi/gha-runners-on-managed-env.git',
                        `--destination=${resultsEcr.repositoryUrl}:latest`
                    ],
                    logConfiguration: {
                        logDriver: 'awslogs',
                        options: {
                            "awslogs-group": kanikoLogGroup.name,
                            "awslogs-region": region.name,
                            "awslogs-stream-prefix": "ecs",
                        }
                    }
                }
            ]),
            cpu: '1024',
            memory: '2048',
            requiresCompatibilities: [
                'FARGATE'
            ],
            runtimePlatform: {
                cpuArchitecture: 'X86_64',
                operatingSystemFamily: 'LINUX'
            },
            networkMode: 'awsvpc',
        })

        const runnerPolicy = new IamPolicy(this, 'RunnerPolicy', {
            policy: Fn.jsonencode(                {
                        'Version': '2012-10-17',
                        'Statement': [
                            {
                                'Sid': 'StartandMonitorTask',
                                'Effect': 'Allow',
                                'Action': [
                                    'ecs:RunTask',
                                    // Needed for waiting
                                    'ecs:DescribeTasks',
                                    'logs:GetLogEvents',
                                    'iam:PassRole',
                                ],
                                'Resource': [
                                    `${kanikoTaskDefinition.arnWithoutRevision}:*`,
                                    // Triggerer has to be allowed to pass both task and task execution role
                                    ecsTaskExecutionRole.arn,
                                    kanikoRole.arn,
                                    `arn:aws:ecs:${region.name}:${identity.accountId}:task/${cluster.name}/*`,
                                    `${kanikoLogGroup.arn}:log-stream:*`,
                                ]
                            },
                            {
                                'Sid': 'GetVpcInfo',
                                'Effect': 'Allow',
                                'Action': [
                                    'ec2:DescribeSubnets',
                                    'ec2:DescribeSecurityGroups'
                                ],
                                'Resource': '*'
                            }
                        ]
                    }

                    )
                })
            new IamRolePolicyAttachment(this, 'RunnerPolicyAttachment', {
                policyArn: runnerPolicy.arn,
                role: runnerRole.name
            })
    }
}
