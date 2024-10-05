import { ContainerCluster } from "@cdktf/provider-google/lib/container-cluster";
import { GoogleProvider } from "@cdktf/provider-google/lib/provider";
import { TerraformStack, CloudBackend, NamedCloudWorkspace, Fn } from "cdktf";
import { Construct } from "constructs";
import { commonVariables } from "./variables";
import { HelmProvider } from "@cdktf/provider-helm/lib/provider";
import { Release } from "@cdktf/provider-helm/lib/release";
import { DataGoogleClientConfig } from "@cdktf/provider-google/lib/data-google-client-config";

export class Autopilot extends TerraformStack {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        new CloudBackend(this, {
            organization: 'hi-fi_org',
            workspaces: new NamedCloudWorkspace(id)
        })

        const { pat, githubConfigUrl } = commonVariables(this);

        const location = 'europe-north1';
        const project = 'gha-runner-example';
        
        new GoogleProvider(this, 'google', {
            project,
            region: location
        });

        const client = new DataGoogleClientConfig(this, 'client', {

        })

        const cluster = new ContainerCluster(this, 'gke', {
            location,
            project,
            name: 'gha-gke-cluster',
            serviceExternalIpsConfig: {
                enabled: false,
            },
            enableAutopilot: true,
            deletionProtection: false,
            // masterAuth: {
            //     clientCertificateConfig: {
            //         issueClientCertificate: true
            //     }
            // }
        });

        new HelmProvider(this, 'helm', {
            kubernetes: {
                // clientKey: cluster.masterAuth.clientKey,
                // clientCertificate: cluster.masterAuth.clientCertificate,
                clusterCaCertificate: Fn.base64decode(cluster.masterAuth.clusterCaCertificate),
                host: cluster.endpoint,
                token: client.accessToken,
            }
        })

        const arc = new Release(this, 'autoscaler', {
            chart: 'oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller',
            name: 'arc',
            createNamespace: true,
            namespace: 'arc-systems',
        });

        new Release(this, 'runners', {
            chart: 'oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set',
            name: 'arc-runner-set',
            createNamespace: true,
            namespace: 'arc-runners',
            set: [
                {
                    name: 'githubConfigUrl',
                    value: githubConfigUrl.value
                },
                {
                    name: 'githubConfigSecret.github_token',
                    value: pat.value
                }
            ],
            dependsOn: [
                arc
            ]
        })
    }
}