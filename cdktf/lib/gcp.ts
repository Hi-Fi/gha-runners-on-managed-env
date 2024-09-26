import { CloudBackend, NamedCloudWorkspace, TerraformLocal, TerraformStack } from "cdktf";
import { Construct } from "constructs";
import { GoogleProvider } from '@cdktf/provider-google/lib/provider'
import { ArtifactRegistryRepository } from "@cdktf/provider-google/lib/artifact-registry-repository";
import { CloudRunV2Job } from "@cdktf/provider-google/lib/cloud-run-v2-job";
import { ProjectIamCustomRole } from "@cdktf/provider-google/lib/project-iam-custom-role";
import { ServiceAccount } from "@cdktf/provider-google/lib/service-account";
import { ProjectIamMember } from "@cdktf/provider-google/lib/project-iam-member";
import { commonVariables } from "./variables";
import { CloudRunService } from "@cdktf/provider-google/lib/cloud-run-service";
import { NullProvider } from "@cdktf/provider-null/lib/provider";
import { Resource } from '@cdktf/provider-null/lib/resource'

export class Gcp extends TerraformStack {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        new CloudBackend(this, {
            organization: 'hi-fi_org',
            workspaces: new NamedCloudWorkspace(id)
        })

        const location = 'europe-north1';
        const project = 'gha-runner-example';
        
        new GoogleProvider(this, 'google', {
            project,
            region: location
        });

        new NullProvider(this, 'null')

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

        const runnerRole = new ProjectIamCustomRole(this, 'runnerRole', {
            roleId: 'ghaRunnerRole',
            title: 'GHA Runner Role',
            permissions: [
                'artifactregistry.dockerimages.get',
                'artifactregistry.dockerimages.list',
                'run.jobs.run',
                'run.jobs.create',
                'run.jobs.delete',
                // Needed for waiting
                'run.executions.get',
            ],
        });

        const jobPolicyMember = new TerraformLocal(this, 'ghaMember', `serviceAccount:${jobSa.email}`)

        new ProjectIamMember(this, 'runnerRoleBinding', {
            member: jobPolicyMember.toString(),
            project,
            role: runnerRole.id,
        })

        new ProjectIamMember(this, 'runnerRoleBindingStorage', {
            member: jobPolicyMember.toString(),
            project,
            role: 'roles/storage.admin',
        })

        const storageName = 'gha-runner-job-externals';
        const createBucket = new TerraformLocal(this, 'bucketModification', `CLOUDSDK_CORE_DISABLE_PROMPTS=1 gcloud alpha storage buckets create gs://${storageName} --project=${project} --location=${location} --uniform-bucket-level-access --enable-hierarchical-namespace`)

        // Hierarchial namespaces can't be enabled with Terraform.
        const bucketCreation = new Resource(this, 'gcloud', {
            provisioners: [
                {
                    type: "local-exec",
                    command: createBucket.fqn
                },
            ],
            triggers: {
                fqn: createBucket.fqn
            },
        });

        // TODO: check caching https://cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images
        const runnerJob = new CloudRunV2Job(this, 'ghaJob', {
            name: 'gha-runner-job',
            location,
            template: {
                template: {
                    containers: [
                        {
                            image: `${registry.location}-docker.pkg.dev/${project}/${registry.repositoryId}/actions/actions-runner:latest`,
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
                                    name: 'CLOUDSDK_RUN_REGION',
                                    value: location,
                                },
                                {
                                    name: 'GOOGLE_CLOUD_PROJECT',
                                    value: project,
                                },
                                {
                                    name: 'EXTERNAL_STORAGE_NAME',
                                    value: storageName,
                                },
                            ],
                            volumeMounts: [
                                {
                                    name: 'externals',
                                    mountPath: '/home/runner/_work/externals'
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
                    volumes: [
                        {
                            name: 'externals',
                            gcs: {
                                bucket: storageName
                            }
                        }
                    ],
                    maxRetries: 0,
                    serviceAccount: jobSa.email
                }
            },
            dependsOn: [
                bucketCreation
            ]
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
                'run.jobs.create',
                'run.jobs.delete',
            ],
        });

        const autoscalerPolicyMember = new TerraformLocal(this, 'autoscalerMember', `serviceAccount:${autoscalerSa.email}`)

        // TODO: replace 2 following with more specific ones.
        new ProjectIamMember(this, 'autoscalerRoleBindingRun', {
            member: autoscalerPolicyMember.toString(),
            project,
            role: 'roles/run.developer',
        })


        new ProjectIamMember(this, 'autoscalerRoleBindingStorage', {
            member: autoscalerPolicyMember.toString(),
            project,
            role: 'roles/storage.admin',
        })

        new CloudRunService(this, 'autoscalerService', {
            location,
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
                            image: `${registry.location}-docker.pkg.dev/${project}/${registry.repositoryId}/hi-fi/gha-runners-on-managed-env:gcp`,
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
