# Creting runner environment to Azure

## Infra

Infra creation is included in the repo using Terraform CDK (CDKTF). Stack is called `gha-runners-on-aca`

Example creates runners with manual trigger, so those needs to be separately started. For actual usage there's possibility to use [KEDA](https://keda.sh) for scaling.

Note that `sudo` doesn't work in runner running on ACA. If some root actions (like package installations) are needed, runner needs to run as root.

## Kaniko

Current example uses hardcoded Docker config to push images to Azure Container Registry (ACR). If wanting more dynamic approach for that, additional Golang app would be to do the starting ("start script") or use Kaniko's debug image. At the start it's possible to override environment variables or commands, which might be enough.

In infra creation Docker configuration is added as volume, as ACR is not working directly without any config. Note that also `AZURE_CLIENT_ID` has to be set as environment variable pointing to identity that has rights to push to target ACR.

Image should be pushed to ACR created within Infra creation by:

```
docker image pull gcr.io/kaniko-project/executor:v1.22.0
docker image tag gcr.io/kaniko-project/executor:v1.22.0 <ACR login server>/kaniko:latest
docker image push <ACR login server>/kaniko:latest
```

## Runner

GitHub provides ready-made container image for the testing. Versions available at [actions-runner](https://github.com/actions/runner/pkgs/container/actions-runner) in GitHub Packages.

This image would require short-lived registration token, which is not handy even when testing runners (as runners are best to kept ephemeral).

Better way is documented at [Azure-Samples/container-apps-ci-cd-runner-tutorial](https://github.com/Azure-Samples/container-apps-ci-cd-runner-tutorial) repository.

Following environment variables need to be set

| Key | Description | Example |
| --- | ----------- | ------- |
| GITHUB_PAT | Personal access token with Actions:Read and Admin:Read+Write scopes | |
| GH_URL | URL for Runner process to connect to | https://github.com/$REPO_OWNER/$REPO_NAME |
| REGISTRATION_TOKEN_API_URL | URL to obtain registration token for Runner | https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/actions/runners/registration-token |

Image should be pushed to ECR created within Infra creation by:

```
docker image build --file images/Dockerfile.gha -t <ACR login server>/gha:latest --target aca .
docker image push <ACR login server>/gha:latest
```
