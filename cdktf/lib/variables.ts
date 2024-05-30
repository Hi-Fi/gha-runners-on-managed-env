import { TerraformVariable } from "cdktf";
import { Construct } from "constructs";

export interface Variables {
    pat: TerraformVariable;
    githubConfigUrl: TerraformVariable;
}

export function commonVariables(scope: Construct): Variables {
    const pat = new TerraformVariable(scope, 'PAT', {
        description: 'Github PAT with Actions:Read and Admin:Read+Write scopes',
        nullable: false,
        sensitive: true
    })

    const githubConfigUrl = new TerraformVariable(scope, 'github_config_url', {
        description: 'Github URL where runners should register to. Format https://<GitHub host>/<your_enterprise/org/repo>',
        nullable: false,
    })

    return {
        pat,
        githubConfigUrl
    }
}