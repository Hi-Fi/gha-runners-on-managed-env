import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsRegion } from '@cdktf/provider-aws/lib/data-aws-region';
import { DataAwsSecurityGroups } from '@cdktf/provider-aws/lib/data-aws-security-groups';
import { DataAwsSubnets } from '@cdktf/provider-aws/lib/data-aws-subnets';
import { EcrRepository } from '@cdktf/provider-aws/lib/ecr-repository';
import { EcsCluster } from '@cdktf/provider-aws/lib/ecs-cluster';
import { EcsService } from '@cdktf/provider-aws/lib/ecs-service';
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

        const autoscalerRole = new IamRole(this, 'AutoscalerRole', {
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

        const autoscalerLogGroup = new CloudwatchLogGroup(this, 'AutoscalerLogGroup', {
            name: '/ecs/Autoscaler',
        });

        // TODO: Images through caching: https://docs.aws.amazon.com/AmazonECR/latest/userguide/pull-through-cache.html
        const runnerTaskDefinition = new EcsTaskDefinition(this, 'RunnerTaskDefinition', {
            family: 'GHA',
            taskRoleArn: runnerRole.arn,
            executionRoleArn: ecsTaskExecutionRole.arn,
            containerDefinitions: Fn.jsonencode([
                {
                    name: 'runner',
                    image: 'ghcr.io/actions/actions-runner:2.316.1',
                    command: ['/home/runner/run.sh'],
                    essential: true,
                    environment: [
                        {
                            name: 'ECS_CLUSTER_NAME',
                            value: cluster.name
                        },
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

        const subnets = new DataAwsSubnets(this, 'Subnets', {});

        const securityGroups = new DataAwsSecurityGroups(this, 'SecurityGroups');

        const autoscalerTaskDefinition = new EcsTaskDefinition(this, 'AutoscalerTaskDefinition', {
            family: 'Autoscaler',
            taskRoleArn: autoscalerRole.arn,
            executionRoleArn: ecsTaskExecutionRole.arn,
            containerDefinitions: Fn.jsonencode([
                {
                    name: 'autoscaler',
                    image: 'ghcr.io/hi-fi/gha-runners-on-managed-env:latest',
                    essential: true,
                    environment: [
                        {
                            name: 'PAT',
                            value: pat.value
                        },
                        {
                            name: 'TASK_DEFINITION_ARN',
                            value: runnerTaskDefinition.arn
                        },
                        {
                            name: 'ECS_CLUSTER',
                            value: cluster.arn
                        },
                        {
                            name: 'ECS_SUBNETS',
                            value: Fn.join(',', subnets.ids)
                        },
                        {
                            name: 'ECS_SECURITY_GROUPS',
                            value: Fn.join(',', securityGroups.ids)
                        },
                        {
                            name: 'SCALE_SET_NAME',
                            value: 'ecs-runner-set'
                        }
                    ],
                    logConfiguration: {
                        logDriver: 'awslogs',
                        options: {
                            "awslogs-group": autoscalerLogGroup.name,
                            "awslogs-region": region.name,
                            "awslogs-stream-prefix": "ecs",
                        }
                    }
                }
            ]),
            cpu: '256',
            memory: '512',
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
                    image: 'gcr.io/kaniko-project/executor:v1.23.0',
                    essential: true,
                    command: [
                        '--dockerfile=images/Dockerfile.gha',
                        '--context=git://github.com/Hi-Fi/gha-runners-on-managed-env.git',
                        `--destination=${resultsEcr.repositoryUrl}:latest`,
                        '--target=nonroot'
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
            policy: Fn.jsonencode({
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

        const autoscalerPolicy = new IamPolicy(this, 'AutoscalerPolicy', {
            policy: Fn.jsonencode({
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
                            `${runnerTaskDefinition.arnWithoutRevision}:*`,
                            // Triggerer has to be allowed to pass both task and task execution role
                            ecsTaskExecutionRole.arn,
                            runnerRole.arn,
                            `arn:aws:ecs:${region.name}:${identity.accountId}:task/${cluster.name}/*`,
                            `${runnerLogGroup.arn}:log-stream:*`,
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
        new IamRolePolicyAttachment(this, 'AutoscalerPolicyAttachment', {
            policyArn: autoscalerPolicy.arn,
            role: autoscalerRole.name
        })

        new EcsService(this, 'AutoscalerService', {
            cluster: cluster.arn,
            name: 'autoscaler-service',
            desiredCount: 1,
            launchType: 'FARGATE',
            taskDefinition: autoscalerTaskDefinition.arnWithoutRevision,
            networkConfiguration: {
                assignPublicIp: true,
                subnets: subnets.ids,
                securityGroups: securityGroups.ids
            },
            lifecycle: {
                ignoreChanges: [
                    'desired_count'
                ]
            }
        })
    }
}
