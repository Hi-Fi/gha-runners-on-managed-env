import { TerraformLocal, TerraformStack, TerraformVariable } from "cdktf";
import { Construct } from "constructs";
import { GoogleProvider } from '@cdktf/provider-google/lib/provider'
import { ArtifactRegistryRepository } from "@cdktf/provider-google/lib/artifact-registry-repository";
import { CloudRunV2Job } from "@cdktf/provider-google/lib/cloud-run-v2-job";
import { DataGoogleClientConfig } from "@cdktf/provider-google/lib/data-google-client-config";
import { ProjectIamCustomRole } from "@cdktf/provider-google/lib/project-iam-custom-role";
import { ServiceAccount } from "@cdktf/provider-google/lib/service-account";
import { ProjectIamMember } from "@cdktf/provider-google/lib/project-iam-member";

export class Gcp extends TerraformStack {
    constructor(scope: Construct, id: string) {
        super(scope, id); 

        new GoogleProvider(this, 'google');

        const client = new DataGoogleClientConfig(this, 'client');

        const pat = new TerraformVariable(this, 'PAT', {
            description: 'Github PAT with Actions:Read and Admin:Read+Write scopes',
            nullable: false,
            sensitive: true
        })

        const registry = new ArtifactRegistryRepository(this, 'registry', {
            format: 'DOCKER',
            repositoryId: 'gha-runner-test',
            description: 'Repository to host run and resulting images from GHA runs',
        });

        const jobSa = new ServiceAccount(this, 'jobServiceAccount', {
            accountId: 'gha-runner-job-sa',
        });

        const kanikoSa = new ServiceAccount(this, 'kanikoServiceAccount', {
            accountId: 'kaniko-job-sa',
        });
        
        const runnerRole = new ProjectIamCustomRole(this, 'runnerRole', {
            roleId: 'ghaRunnerRole',
            title: 'GHA Runner Role',
            permissions: [
                'artifactregistry.dockerimages.get',
                'artifactregistry.dockerimages.list',
                'run.jobs.run',
                // Needed for waiting
                'run.executions.get'
            ],
        });

        const jobPolicyMember = new TerraformLocal(this, 'ghaMember', `serviceAccount:${jobSa.email}`)

        new ProjectIamMember(this, 'runnerRoleBinding', {
            member: jobPolicyMember.toString(),
            project: client.project,
            role: runnerRole.id,
        })    

        const kanikoPolicyMember = new TerraformLocal(this, 'kanikoMember', `serviceAccount:${kanikoSa.email}`)

        new ProjectIamMember(this, 'kanikoRoleBinding', {
            member: kanikoPolicyMember.toString(),
            project: client.project,
            role: 'roles/artifactregistry.writer',
        })        

        const kanikoJob = new CloudRunV2Job(this, 'kanikoJob', {
            name: 'kaniko-job',
            location: client.region,
            template: {
                template: {
                    containers: [
                        {
                            image: `${registry.location}-docker.pkg.dev/${client.project}/${registry.repositoryId}/kaniko:latest`,
                            args: [
                                '--dockerfile=images/Dockerfile.gha',
                                '--context=git://github.com/Hi-Fi/gha-runners-on-managed-env.git',
                                `--destination=${registry.location}-docker.pkg.dev/${client.project}/${registry.repositoryId}/results:latest`,
                                '--target=nonroot'
                            ],
                            resources: {
                                limits: {
                                    cpu: '1',
                                    memory: '2Gi'
                                }
                            }
                        }
                    ],
                    maxRetries: 0,
                    serviceAccount: kanikoSa.email
                }
            }
        })

        new CloudRunV2Job(this, 'ghaJob', {
            name: 'gha-runner-job',
            location: client.region,
            template: {
                template: {
                    containers: [
                        {
                            image: `${registry.location}-docker.pkg.dev/${client.project}/${registry.repositoryId}/gha:latest`,
                            env: [
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
                                },
                                {
                                    name: 'CLOUDSDK_RUN_REGION',
                                    value: client.region,
                                },
                                {
                                    name: 'KANIKO_JOB',
                                    value: kanikoJob.name
                                }
                            ],
                            resources: {
                                limits: {
                                    cpu: '1',
                                    memory: '2Gi'
                                }
                            },
                        }
                    ],
                    maxRetries: 0,
                    serviceAccount: jobSa.email
                }
            }
        })
    }
}