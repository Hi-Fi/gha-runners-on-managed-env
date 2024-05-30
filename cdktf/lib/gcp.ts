import { TerraformLocal, TerraformStack } from "cdktf";
import { Construct } from "constructs";
import { GoogleProvider } from '@cdktf/provider-google/lib/provider'
import { ArtifactRegistryRepository } from "@cdktf/provider-google/lib/artifact-registry-repository";
import { CloudRunV2Job } from "@cdktf/provider-google/lib/cloud-run-v2-job";
import { DataGoogleClientConfig } from "@cdktf/provider-google/lib/data-google-client-config";
import { ProjectIamCustomRole } from "@cdktf/provider-google/lib/project-iam-custom-role";
import { ServiceAccount } from "@cdktf/provider-google/lib/service-account";
import { ProjectIamMember } from "@cdktf/provider-google/lib/project-iam-member";
import { commonVariables } from "./variables";
import { CloudRunService } from "@cdktf/provider-google/lib/cloud-run-service";

export class Gcp extends TerraformStack {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        new GoogleProvider(this, 'google');

        const client = new DataGoogleClientConfig(this, 'client');

        const { pat, githubConfigUrl } = commonVariables(this);

        const registry = new ArtifactRegistryRepository(this, 'registry', {
            format: 'DOCKER',
            mode: 'REMOTE_REPOSITORY',
            repositoryId: 'gha-runner-test',
            description: 'Repository to host run and resulting images from GHA runs',
            remoteRepositoryConfig: {
                dockerRepository: {
                    customRepository: {
                        uri: 'https://ghcr.io'
                    }
                }
            }
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

        // TODO: check caching https://cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images
        const kanikoJob = new CloudRunV2Job(this, 'kanikoJob', {
            name: 'kaniko-job',
            location: client.region,
            template: {
                template: {
                    containers: [
                        {
                            image: 'gcr.io/kaniko-project/executor:latest',
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

        const runnerJob = new CloudRunV2Job(this, 'ghaJob', {
            name: 'gha-runner-job',
            location: client.region,
            template: {
                template: {
                    containers: [
                        {
                            image: `${registry.location}-docker.pkg.dev/${client.project}/${registry.repositoryId}/actions/actions-runner:latest`,
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
                            command: ['/home/runner/run.sh'],
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

        const autoscalerSa = new ServiceAccount(this, 'autoscalerServiceAccount', {
            accountId: 'autoscaler-sa',
        });

        new ProjectIamCustomRole(this, 'autoscalerRole', {
            roleId: 'ghaAutoscalerRole',
            title: 'GHA Autoscaler Role',
            permissions: [
                'artifactregistry.dockerimages.get',
                'artifactregistry.dockerimages.list',
                'run.jobs.run',
            ],
        });

        const autoscalerPolicyMember = new TerraformLocal(this, 'autoscalerMember', `serviceAccount:${autoscalerSa.email}`)

        new ProjectIamMember(this, 'autoscalerRoleBinding', {
            member: autoscalerPolicyMember.toString(),
            project: client.project,
            role: 'roles/run.developer',
        })

        new CloudRunService(this, 'autoscalerService', {
            location: client.region,
            name: 'gha-autoscaler',
            metadata: {
                annotations: {
                    'run.googleapis.com/ingress': 'internal',
                }
            },
            template: {
                metadata: {
                    annotations: {
                        'autoscaling.knative.dev/maxScale': '1',
                        'autoscaling.knative.dev/minScale': '1',
                    }
                },
                spec: {
                    containerConcurrency: 1,
                    containers: [
                        {
                            image: `${registry.location}-docker.pkg.dev/${client.project}/${registry.repositoryId}/hi-fi/gha-runners-on-managed-env:gcp`,
                            env: [
                                {
                                    name: 'PAT',
                                    value: pat.value
                                },
                                {
                                    name: 'GITHUB_CONFIG_URL',
                                    value: githubConfigUrl.value
                                },
                                {
                                    name: 'JOB_NAME',
                                    value: runnerJob.id
                                },
                                {
                                    name: 'SCALE_SET_NAME',
                                    value: 'cr-runner-set'
                                }
                            ],
                            resources: {
                                limits: {
                                    cpu: '200m',
                                    memory: '128Mi'
                                }
                            }
                        }
                    ],
                    serviceAccountName: autoscalerSa.email
                }
            }
        })
    }
}
