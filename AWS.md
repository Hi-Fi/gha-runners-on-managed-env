# Creting runner environment to AWS

## Infra

Infra creation is included in the repo using Terraform CDK (CDKTF).

Example infra is created to AWS ECS. It doesn't have automated scaling but runner job has to started manually.

## Kaniko

Current example uses hardcoded Docker config to push images to Elastic Container Registry (ECR). If wanting more dynamic approach for that, additional Golang app would be to do the starting ("start script") or use Kaniko's debug image. At the start it's possible to override environment variables or commands, which might be enough.

As ECR access works out of the box, there's no need in this example to create custom Kaniko image.

Image should be pushed to ECR created within Infra creation by:

```
docker image pull gcr.io/kaniko-project/executor:v1.22.0
docker image tag gcr.io/kaniko-project/executor:v1.22.0 <AWS account>.dkr.ecr.<AWS region>.amazonaws.com/kaniko:latest
docker image push <AWS account>.dkr.ecr.<AWS region>.amazonaws.com/kaniko:latest
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
docker image build --file images/Dockerfile.gha -t <AWS account>.dkr.ecr.<AWS region>.amazonaws.com/gha:latest --target ecs .
docker image push <AWS account>.dkr.ecr.<AWS region>.amazonaws.com/gha:latest
```
