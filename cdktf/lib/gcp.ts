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
                'run.jobs.list',
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

        new ProjectIamMember(this, 'runnerRoleBindingRunServiceAgent', {
            member: jobPolicyMember.toString(),
            project,
            role: 'roles/run.serviceAgent',
        })

        new ProjectIamMember(this, 'runnerRoleBindingRunViewer', {
            member: jobPolicyMember.toString(),
            project,
            role: 'roles/run.viewer',
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
            deletionProtection: false,
            name: 'gha-runner-job',
            location,
            template: {
                template: {
                    containers: [
                        {
                            image: `${registry.location}-docker.pkg.dev/${project}/${registry.repositoryId}/hi-fi/actions-runner:cr`,
                            env: [
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
                                // FUSE mounts directory as root with 777 fo directories and 555 for other files. As path is owned always by root, utime or permission change is not possible. These options prevent tar to try those
                                {
                                    name: 'TAR_OPTIONS',
                                    value: '--touch --no-overwrite-dir --no-same-owner'
                                }
                            ],
                            volumeMounts: [
                                {
                                    name: 'externals',
                                    mountPath: '/home/runner/_work/externals'
                                }
                            ],
                            command: ['/home/runner/ephemeral_runner.sh'],
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

        new ProjectIamMember(this, 'autoscalerRoleBindingRunServiceAgent', {
            member: autoscalerPolicyMember.toString(),
            project,
            role: 'roles/run.serviceAgent',
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
                        'run.googleapis.com/cpu-throttling': 'false',
                        'run.googleapis.com/startup-cpu-boost': 'false'
                    }
                },
                spec: {
                    containerConcurrency: 1,
                    containers: [
                        {
                            image: `${registry.location}-docker.pkg.dev/${project}/${registry.repositoryId}/hi-fi/gha-runners-on-managed-env:test`,
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
                                    value: runnerJob.name
                                },
                                {
                                    name: 'SCALE_SET_NAME',
                                    value: 'cr-runner-set'
                                },
                                {
                                    name: 'CLOUDSDK_RUN_REGION',
                                    value: location
                                },
                                {
                                    name: 'GOOGLE_CLOUD_PROJECT',
                                    value: project
                                }

                            ],
                            resources: {
                                // Service would work for much lower, but these are minimum values for "always on" mode
                                limits: {
                                    cpu: '1000m',
                                    memory: '512Mi'
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
