# Example how to include Kaniko image build to workflow when runner running on managed container environment

As tested in [Hi-Fi/image-build-on-managed-app-services](https://github.com/Hi-Fi/image-build-on-managed-app-services), building of image is possible at managed container environments (in the example AWS Elastic Container Service (ECS)).

Open issue still was left, how this kind of build could be included in GitHub Actions workflow. Some options considered:

- Include Kaniko to same image with runner; This partially works, but can create strange issues as Kaniko would be overwriting whole running container's filesystem
  - At least if there's step after image build, runner process fails as it's log file disappears
- Fake somehow the root directory in a way that Kaniko would think that it's working in root while actual directory is something else
  - Currently no option found that would work with the limited capabilities offered
- Trigger separate task from runner's task and follow execution of that.
  - Creates double costs for some time

## Comparison on various managed environment for GHA runner hosting

| Area / Service   | [Elastic Container Service](https://aws.amazon.com/ecs/)                                                                      | [Azure Container Apps](https://azure.microsoft.com/en-us/products/container-apps)                                                                                                                                                                                                                | [Google Cloud Run](https://cloud.google.com/run)                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Specific service | [ECS Tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/standalone-tasks.html) with Fargate                   | [ACA Jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs?tabs=azure-cli) with Consumption only / Consumption workload profile                                                                                                                                                      | [Google Cloud Run Jobs](https://cloud.google.com/run/docs/create-jobs)                              |
| Scaling          | Custom solution needed, no in-built automated way to scale runners on when needed                                             | Utilizes [KEDA](https://keda.sh), simple scaling of runners                                                                                                                                                                                                                                      | Custom solution needed, no in-built automated way to scale runners on when needed                   |
| Storage          | [Ephemeral default 20GiB, max 200 GiB](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html) | [Ephemeral 1-8 GiB depending on CPU count](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts?tabs=smb&pivots=azure-resource-manager#ephemeral-storage)                                                                                                                       | [In-memory inside runner instance](https://cloud.google.com/run/docs/container-contract#filesystem) |
| Price region     | Europe (Stockholm), eu-north-1                                                                                                | Sweden Central                                                                                                                                                                                                                                                                                   | [Tier 1](https://cloud.google.com/run/pricing#tier-1)                                               |
| Price, vCPU      | $0.0445/hour                                                                                                                  | $0.0864/hour                                                                                                                                                                                                                                                                                     | $0.0648/hour                                                                                        |
| Price, memory    | $0.0049/GiB-hour                                                                                                              | $0.0108/GiB-hour                                                                                                                                                                                                                                                                                 | $0.0072/GiB-hour                                                                                    |
| Free tier        | None                                                                                                                          | 180,000 vCPU-seconds and 360,000 GiB-seconds                                                                                                                                                                                                                                                     | 240,000 vCPU-seconds and 450,000 GiB-seconds                                                        |
| Other notes      |                                                                                                                               | No possibility to `sudo`; resulting error with same image that works with ECS. <br> `sudo: The "no new privileges" flag is set, which prevents sudo from running as root.`<br>`sudo: If sudo is running in a container, you may need to adjust the container configuration to disable the flag.` | Kaniko's DNS resolving doesn't work, but required some `resolv.conf` hacks                          |

## Environment specific documentations

- [AWS](./AWS.md)
- [Azure](./Azure.md)
- [Google Cloud Platform](./GCP.md)
