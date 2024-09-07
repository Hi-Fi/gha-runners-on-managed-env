import { AzurermProvider } from "@cdktf/provider-azurerm/lib/provider";
import { AzapiProvider } from '../.gen/providers/azapi/provider'
import { Resource } from '../.gen/providers/azapi/resource'
import { DataAzapiResourceAction } from '../.gen/providers/azapi/data-azapi-resource-action'
import { Fn, TerraformLocal, TerraformStack, TerraformVariable } from "cdktf";
import { Construct } from "constructs";
import { ResourceGroup } from "@cdktf/provider-azurerm/lib/resource-group";
import { ContainerRegistry } from "@cdktf/provider-azurerm/lib/container-registry";
import { UserAssignedIdentity } from "@cdktf/provider-azurerm/lib/user-assigned-identity";
import { RoleAssignment } from "@cdktf/provider-azurerm/lib/role-assignment";
import { LogAnalyticsWorkspace } from "@cdktf/provider-azurerm/lib/log-analytics-workspace";
import { RoleDefinition } from "@cdktf/provider-azurerm/lib/role-definition";
import { DataAzurermSubscription } from "@cdktf/provider-azurerm/lib/data-azurerm-subscription";
import { ContainerApp } from "@cdktf/provider-azurerm/lib/container-app";
import { commonVariables } from "./variables";
import { ContainerAppEnvironmentStorage } from "@cdktf/provider-azurerm/lib/container-app-environment-storage";

export class Azure extends TerraformStack {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        new AzurermProvider(this, 'azurerm', {
            features: [
                {}
            ]
        })

        new AzapiProvider(this, 'azapi', {
        })

        const sub = new DataAzurermSubscription(this, 'sub', {});

        const { pat, githubConfigUrl } = commonVariables(this);

        const location = new TerraformVariable(this, 'location', {
            default: 'westeurope',
            description: 'Location where to provision resources to',
            type: 'string',
            sensitive: false,
            nullable: false
        }).value;

        const rg = new ResourceGroup(this, 'rg', {
            location,
            name: 'gha-runner-rg',
            lifecycle: {
                ignoreChanges: [
                    'tags'
                ]
            }
        });

        const acr = new ContainerRegistry(this, 'acr', {
            location,
            name: 'runnerexampleacr',
            resourceGroupName: rg.name,
            sku: 'Basic',
            lifecycle: {
                ignoreChanges: [
                    'tags'
                ]
            }
        });

        // use caching for images
        const kanikoCache = new Resource(this, 'kanikoCache', {
            type: 'Microsoft.ContainerRegistry/registries/cacheRules@2023-01-01-preview',
            parentId: acr.id,
            name: 'kaniko-cache',
            body: {
                properties: {
                    sourceRepository: 'gcr.io/kaniko-project/executor',
                    targetRepository: 'kaniko'
                }
            }
        })

        const runnerCache = new Resource(this, 'runnerCache', {
            type: 'Microsoft.ContainerRegistry/registries/cacheRules@2023-01-01-preview',
            parentId: acr.id,
            name: 'root-runner-cache',
            body: {
                properties: {
                    sourceRepository: 'ghcr.io/hi-fi/root-actions-runner',
                    targetRepository: 'root-actions-runner'
                }
            }
        })

        const autoscalerCache = new Resource(this, 'autoscalerCache', {
            type: 'Microsoft.ContainerRegistry/registries/cacheRules@2023-01-01-preview',
            parentId: acr.id,
            name: 'autoscaler-cache',
            body: {
                properties: {
                    sourceRepository: 'ghcr.io/hi-fi/gha-runners-on-managed-env',
                    targetRepository: 'autoscaler'
                }
            }
        })

        const identity = new UserAssignedIdentity(this, 'identity', {
            location,
            name: 'aca-acr-access',
            resourceGroupName: rg.name,
            lifecycle: {
                ignoreChanges: [
                    'tags'
                ]
            }
        });

        new RoleAssignment(this, 'roleAssignment', {
            principalId: identity.principalId,
            scope: acr.id,
            roleDefinitionName: 'AcrPull'
        });

        const log = new LogAnalyticsWorkspace(this, 'log', {
            location,
            name: 'gha-example-logs',
            resourceGroupName: rg.name,
            lifecycle: {
                ignoreChanges: [
                    'tags'
                ]
            }
        })

        const storageAccount = new Resource(this, 'storageAccount', {
            type: 'Microsoft.Storage/storageAccounts@2023-01-01',
            parentId: rg.id,
            location,
            name: 'ghaexamplestorageaccount',
            body: {
                properties: {
                    largeFileSharesState: 'Enabled'
                },
                sku: {
                    name: 'Standard_LRS'
                },
                kind: 'StorageV2',
            },
            lifecycle: {
                ignoreChanges: [
                    'tags'
                ]
            },
            responseExportValues: [

            ]
        });

        const storageShare = new Resource(this, 'storageShare', {
            type: 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-01-01',
            name: 'ghaexampleshare',
            parentId: `${storageAccount.id}/fileServices/default`,
            body: {
                properties: {
                    enabledProtocols: 'SMB',
                }
            },
        });

        const externalsShare = new Resource(this, 'externalsShare', {
            type: 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-01-01',
            name: 'ghaexternalsshare',
            parentId: `${storageAccount.id}/fileServices/default`,
            body: {
                properties: {
                    enabledProtocols: 'SMB',
                }
            },
        });

        const environment = new Resource(this, 'acaenv', {
            type: 'Microsoft.App/managedEnvironments@2024-03-01',
            parentId: rg.id,
            location,
            name: 'gha-runner-environment',
            body: {
                properties: {
                    appLogsConfiguration: {
                        destination: 'log-analytics',
                        logAnalyticsConfiguration: {
                            customerId: log.workspaceId,
                            sharedKey: log.primarySharedKey,
                        }
                    },
                    infrastructureResourceGroup: 'managed-aca-rg',
                    workloadProfiles: [
                        {
                            name: 'Consumption',
                            workloadProfileType: 'Consumption'
                        }
                    ]
                }
            },
            lifecycle: {
                ignoreChanges: [
                    'tags'
                ]
            }
        });

        const storageAccessKey = new DataAzapiResourceAction(this, 'storageAccessKeys', {
            type: 'Microsoft.Storage/storageAccounts@2023-01-01',
            action: 'listKeys',
            resourceId: storageAccount.id,
            responseExportValues: ['*']
        });

        // see https://github.com/hashicorp/terraform-cdk/issues/1641
        const accessKey = Fn.lookup(Fn.element(Fn.lookup(Fn.jsondecode(storageAccessKey.output as any), 'keys'), 0), 'value')

        const acaEnvStorage = new ContainerAppEnvironmentStorage(this, 'acaenvstorage', {
            name: 'gharunnerjobstorage',
            accessKey,
            accessMode: 'ReadWrite',
            accountName: storageAccount.name,
            containerAppEnvironmentId: environment.id,
            shareName: storageShare.name,
            dependsOn: [
                // Name doesn't create dependsOn requirement, so adding that explicitly
                storageShare
            ] 
        });

        const acaExternalStorage = new ContainerAppEnvironmentStorage(this, 'acaexternalstorage', {
            name: 'gharunnerexternalstorage',
            accessKey,
            accessMode: 'ReadWrite',
            accountName: storageAccount.name,
            containerAppEnvironmentId: environment.id,
            shareName: externalsShare.name,
            dependsOn: [
                // Name doesn't create dependsOn requirement, so adding that explicitly
                externalsShare
            ] 
        });
        

        // Have to use Terraform local variable as trying to use jsonencode directly would fail.
        const dockerConfig = new TerraformLocal(this, 'dockerConfig', {
            credHelpers: {
                [acr.loginServer]: 'acr-env'
            }
        });

        // TODO: Images through caching: https://techcommunity.microsoft.com/t5/apps-on-azure-blog/announcing-public-preview-of-caching-for-acr/ba-p/3744655
        const kanikoJob = new Resource(this, 'kanikoJob', {
            type: 'Microsoft.App/jobs@2023-05-01',
            name: 'kaniko-job-01',
            parentId: rg.id,
            location,
            identity: [
                {
                    type: 'UserAssigned',
                    identityIds: [
                        identity.id
                    ]
                }
            ],
            body: {
                properties: {
                    configuration: {
                        manualTriggerConfig: {
                            parallelism: 1,
                            replicaCompletionCount: 1
                        },
                        registries: [
                            {
                                identity: identity.id,
                                server: acr.loginServer
                            }
                        ],
                        triggerType: 'Manual',
                        replicaTimeout: 1200,
                        secrets: [
                            {
                                name: 'docker-config',
                                value: Fn.jsonencode(dockerConfig.expression)
                            }
                        ]
                    },
                    environmentId: environment.id,
                    template: {
                        containers: [
                            {
                                args: [
                                    '--dockerfile=images/Dockerfile.gha',
                                    '--context=git://github.com/Hi-Fi/gha-runners-on-managed-env.git',
                                    `--destination=${acr.loginServer}/results:latest`,
                                    '--target=root'
                                ],
                                image: `${acr.loginServer}/kaniko:v1.23.0`,
                                name: 'main',
                                resources: {
                                    cpu: 1,
                                    memory: '2Gi'
                                },
                                env: [
                                    // https://github.com/microsoft/azure-container-apps/issues/502#issuecomment-1340225438
                                    {
                                        name: 'APPSETTING_WEBSITE_SITE_NAME',
                                        value: 'identity-workaround'
                                    },
                                    // https://github.com/microsoft/azure-container-apps/issues/442#issuecomment-1665621031
                                    {
                                        name: 'AZURE_CLIENT_ID',
                                        value: identity.clientId
                                    }
                                ],
                                volumeMounts: [
                                    {
                                        mountPath: '/kaniko/.docker/config.json',
                                        subPath: 'config.json',
                                        volumeName: 'dockerconfig'
                                    }
                                ]
                            }
                        ],
                        volumes: [
                            {
                                name: 'dockerconfig',
                                secrets: [
                                    {
                                        secretRef: 'docker-config',
                                        path: 'config.json'
                                    }
                                ],
                                storageType: 'Secret'
                            }
                        ]
                    }
                }
            },
            dependsOn: [
                kanikoCache
            ],
            lifecycle: {
                ignoreChanges: [
                    'tags'
                ]
            }
        });

        const runnerVolumeName = 'work'
        const externalVolumeName = 'externals'

        /**
         * @see https://learn.microsoft.com/en-us/azure/templates/microsoft.app/jobs?pivots=deployment-language-terraform
         */
        const ghaRunnerJob = new Resource(this, 'ghaRunnerJob', {
            type: 'Microsoft.App/jobs@2024-02-02-preview',
            identity: [
                {
                    type: 'UserAssigned',
                    identityIds: [
                        identity.id
                    ]
                }
            ],
            name: 'gha-runner-job-01',
            parentId: rg.id,
            location,
            body: {
                properties: {
                    configuration: {
                        manualTriggerConfig: {
                            parallelism: 1,
                            replicaCompletionCount: 1,
                        },
                        triggerType: 'Manual',
                        replicaTimeout: 1200,
                        registries: [
                            {
                                identity: identity.id,
                                server: acr.loginServer
                            }
                        ],
                    },
                    environmentId: environment.id,
                    template: {
                        containers: [
                            {
                                resources: {
                                    cpu: 1,
                                    memory: '2Gi',
                                },
                                // Have to use custom image as we want to run service as root to be able to install packages
                                image: `${acr.loginServer}/root-actions-runner:latest`,
                                name: 'main',
                                command: ['/bin/sh', '-c', 'export EXECID=$(cat /proc/sys/kernel/random/uuid) && mkdir -p /tmp/_work/$EXECID && ln -s /tmp/_work/$EXECID _work && /home/runner/run.sh ; rm -r /tmp/_work/$EXECID'],
                                volumeMounts: [
                                    {
                                        mountPath: '/tmp/_work',
                                        volumeName: runnerVolumeName,
                                    },
                                    {
                                        mountPath: '/tmp/externals',
                                        volumeName: externalVolumeName,
                                    }
                                ],
                                env: [
                                    // https://github.com/microsoft/azure-container-apps/issues/502#issuecomment-1340225438
                                    {
                                        name: 'APPSETTING_WEBSITE_SITE_NAME',
                                        value: 'identity-workaround'
                                    },
                                    // https://github.com/microsoft/azure-container-apps/issues/442#issuecomment-1665621031
                                    {
                                        name: 'AZURE_CLIENT_ID',
                                        value: identity.clientId
                                    },
                                    // Variables so that no hardcoded values or extra calls to APIs needed
                                    {
                                        name: 'JOB_NAME',
                                        value: kanikoJob.name
                                    },
                                    {
                                        name: 'RG_NAME',
                                        value: rg.name
                                    },
                                    {
                                        name: 'LOG_ID',
                                        value: log.workspaceId
                                    },
                                    {
                                        name: 'STORAGE_NAME',
                                        value: acaEnvStorage.name
                                    },
                                    {
                                        name: 'EXTERNAL_STORAGE_NAME',
                                        value: acaExternalStorage.name
                                    },
                                    {
                                        name: 'SUBSCRIPTION_ID',
                                        value: sub.subscriptionId
                                    },
                                    {
                                        name: 'ACA_ENVIRONMENT_ID',
                                        value: environment.id
                                    }
                                ],
                            },
                        ],
                        volumes: [
                            {
                                name: runnerVolumeName,
                                storageName: acaEnvStorage.name,
                                storageType: 'AzureFile',
                                mountOptions: 'mfsymlinks'
                            },
                            {
                                name: externalVolumeName,
                                storageName: acaExternalStorage.name,
                                storageType: 'AzureFile',
                                mountOptions: 'mfsymlinks'
                            }
                        ]
                    }
                }
            },
            dependsOn: [
                runnerCache
            ],
            lifecycle: {
                ignoreChanges: [
                    'tags'
                ]
            }
        });

        const autoscalerApp = new ContainerApp(this, 'autoscalerApp', {
            containerAppEnvironmentId: environment.id,
            name: 'autoscaler-app-01',
            resourceGroupName: rg.name,
            revisionMode: 'Single',
            identity: {
                type: 'SystemAssigned, UserAssigned',
                identityIds: [
                    identity.id
                ]
            },
            secret: [
                {
                    name: 'pat',
                    value: pat.value
                }
            ],
            registry: [
                {
                    identity: identity.id,
                    server: acr.loginServer
                }
            ],
            template: {
                container: [
                    {
                        // CPU and Memory can be lower with workload profile
                        cpu: 0.25,
                        memory: '0.5Gi',
                        image: `${acr.loginServer}/autoscaler:test`,
                        name: 'autoscaler',
                        env: [
                            {
                                name: 'PAT',
                                secretName: 'pat',
                            },
                            {
                                name: 'GITHUB_CONFIG_URL',
                                value: githubConfigUrl.value
                            },
                            {
                                name: 'AZURE_TENANT_ID',
                                value: sub.tenantId,
                            },
                            {
                                name: 'SUBSCRIPTION_ID',
                                value: sub.subscriptionId
                            },
                            {
                                name: 'RESOURCE_GROUP_NAME',
                                value: rg.name
                            },
                            {
                                name: 'APP_NAME',
                                value: ghaRunnerJob.name
                            },
                            {
                                name: 'SCALE_SET_NAME',
                                value: 'aca-runner-set'
                            },
                        ]
                    }
                ]
            },
            dependsOn: [
                autoscalerCache
            ],
            lifecycle: {
                ignoreChanges: [
                    'tags',
                    'workload_profile_name'
                ]
            }
        });

        /**
         * @see https://github.com/microsoft/azure-container-apps/issues/1024
         */
        const role = new RoleDefinition(this, 'jobRole', {
            name: `${sub.subscriptionId}-gha-example-revision-start-role`,
            scope: sub.id,
            permissions: [
                {
                    actions: [
                        'microsoft.app/jobs/start/action',
                        'microsoft.app/jobs/stop/action',
                        'microsoft.app/jobs/read',
                        'microsoft.app/jobs/executions/read',
                    ],
                }
            ]
        })

        const jobCreationRole = new RoleDefinition(this, 'jobCreationRole', {
            name: `${sub.subscriptionId}-gha-example-revision-create-role`,
            scope: sub.id,
            permissions: [
                {
                    actions: [
                        'microsoft.app/jobs/start/action',
                        'microsoft.app/jobs/stop/action',
                        'microsoft.app/jobs/read',
                        'microsoft.app/jobs/write',
                        'microsoft.app/jobs/executions/read',
                        'microsoft.App/managedEnvironments/join/action'
                    ],
                }
            ]
        })

        // Allow autoscaler to create new revision of app
        new RoleAssignment(this, 'scaleJobRoleAssignment', {
            principalId: autoscalerApp.identity.principalId,
            scope: ghaRunnerJob.id,
            roleDefinitionId: role.roleDefinitionResourceId
        })

        // Allow starting of the job
        new RoleAssignment(this, 'jobStartRoleAssignment', {
            principalId: identity.principalId,
            scope: kanikoJob.id,
            roleDefinitionId: role.roleDefinitionResourceId
        });

        // Allow runner to start the job. As each one created new job, have to give to RG level.
        new RoleAssignment(this, 'actionContainerStartRoleAssignment', {
            principalId: identity.principalId,
            scope: rg.id,
            roleDefinitionId: jobCreationRole.roleDefinitionResourceId
        })

        new RoleAssignment(this, 'imagePushRoleAssignment', {
            principalId: identity.principalId,
            scope: acr.id,
            roleDefinitionName: 'AcrPush'
        });

        new RoleAssignment(this, 'jobLogReadAssignment', {
            principalId: identity.principalId,
            scope: log.id,
            roleDefinitionName: 'Log Analytics Reader'
        })
    }
}