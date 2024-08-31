package azure

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore/to"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/appcontainers/armappcontainers/v2"
)

type Aca struct {
	ctx               context.Context
	logger            *slog.Logger
	client            *armappcontainers.ContainerAppsClient
	resourceGroupName string
	appName           string
}

func GetClient(ctx context.Context, logger *slog.Logger) (*Aca, error) {
	subscriptionId, err1 := requireEnv("SUBSCRIPTION_ID")
	resourceGroupName, err2 := requireEnv("RESOURCE_GROUP_NAME")
	appName, err3 := requireEnv("APP_NAME")

	if errors.Join(err1, err2, err3) != nil {
		return nil, errors.Join(err1, err2, err3)
	}
	cred, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return nil, err
	}
	client, err := armappcontainers.NewContainerAppsClient(subscriptionId, cred, nil)
	if err != nil {
		return nil, err
	}

	return &Aca{
		ctx:               ctx,
		logger:            logger,
		client:            client,
		resourceGroupName: resourceGroupName,
		appName:           appName,
	}, nil
}

func (a *Aca) CurrentRunnerCount() (int, error) {
	return 0, fmt.Errorf("not implemented")
}

func (a *Aca) TriggerNewRunners(count int, jitConfig string) (err error) {
	appDefinition, err := a.client.Get(a.ctx, a.resourceGroupName, a.appName, nil)
	if err != nil {
		return err
	}
	// Append JIT key to environment variables
	container := appDefinition.Properties.Template.Containers[0]

	env := []*armappcontainers.EnvironmentVar{}

	for _, envVar := range container.Env {
		if *envVar.Name != "ACTIONS_RUNNER_INPUT_JITCONFIG" {
			env = append(env, envVar)
		}
	}

	_, err = a.client.BeginUpdate(a.ctx, a.resourceGroupName, a.appName, armappcontainers.ContainerApp{
		Location: appDefinition.Location,
		Properties: &armappcontainers.ContainerAppProperties{
			EnvironmentID: appDefinition.Properties.EnvironmentID,
			Template: &armappcontainers.Template{
				Containers: []*armappcontainers.Container{
					{
						Name:      container.Name,
						Image:     container.Image,
						Resources: container.Resources,
						Command:   container.Command,
						Args:      container.Args,
						Env: append(
							env,
							&armappcontainers.EnvironmentVar{
								Name:  to.Ptr("ACTIONS_RUNNER_INPUT_JITCONFIG"),
								Value: &jitConfig,
							},
						),
						VolumeMounts: container.VolumeMounts,
					},
				},
				Scale: &armappcontainers.Scale{
					MaxReplicas: to.Ptr(int32(1)),
					MinReplicas: to.Ptr(int32(1)),
				},
			},
		},
	}, &armappcontainers.ContainerAppsClientBeginUpdateOptions{})

	return err
}

func (a *Aca) NeededRunners(count int, jitConfig string) (err error) {
	return fmt.Errorf("not implemented")

}

func requireEnv(key string) (value string, err error) {
	value = os.Getenv(key)
	if len(value) == 0 {
		err = fmt.Errorf("value required for environment variable %s", key)
	}
	return
}
