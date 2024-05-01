# Example how to include Kaniko image build to workflow when runner running on managed container environment

As tested in [Hi-Fi/image-build-on-managed-app-services](https://github.com/Hi-Fi/image-build-on-managed-app-services), building of image is possible at managed container environments (in the example AWS Elastic Container Service (ECS)).

Open issue still was left, how this kind of build could be included in GitHub Actions workflow. Some options considered:

- Include Kaniko to same image with runner; This partially works, but can create strange issues as Kaniko would be overwriting whole running container's filesystem
  - At least if there's step after image build, runner process fails as it's log file disappears
- Fake somehow the root directory in a way that Kaniko would think that it's working in root while actual directory is something else
  - Currently no option found that would work with the limited capabilities offered
- Trigger separate task from runner's task and follow execution of that.
  - Creates double costs for some time

## Creting runner environment to AWS

### Kaniko

Current example uses hardcoded Docker config to push images to Elastic Container Registry (ECR). If wanting more dynamic approach for that, additional Golang app would be to do the starting ("start script") or use Kaniko's debug image.

As ECR access works out of the box, there's no need in this example to create custom Kaniko image.

### Runner

GitHub provides ready-made container image for the testing. Versions available at [actions-runner](https://github.com/actions/runner/pkgs/container/actions-runner) in GitHub Packages.

This image would require short-lived registration token, which is not handy even when testing runners (as runners are best to kept ephemeral).

Better way is documented at [Azure-Samples/container-apps-ci-cd-runner-tutorial](https://github.com/Azure-Samples/container-apps-ci-cd-runner-tutorial) repository.

Following environment variables need to be set

| Key | Description | Example |
| --- | ----------- | ------- |
| GITHUB_PAT | Personal access token with Actions:Read and Admin:Read+Write scopes | |
| GH_URL | URL for Runner process to connect to | https://github.com/$REPO_OWNER/$REPO_NAME |
| REGISTRATION_TOKEN_API_URL | URL to obtain registration token for Runner | https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/actions/runners/registration-token |

### Infra

Infra creation is included in the repo using Terraform CDK (CDKTF).

Example infra is created to AWS ECS which is not easiest opttion for Runners as it doesn't support as easy scaling as Azure Container App Jobs does (latter with [KEDA](https://keda.sh)). But for the demo here it's enough with possibility to go and start Runner tasks manually. 

If wanting to use ECS to host actual Runners, some autoscaling solution/service should be used or created.
