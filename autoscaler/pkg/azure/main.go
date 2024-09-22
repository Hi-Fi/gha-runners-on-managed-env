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
	client            *armappcontainers.JobsClient
	resourceGroupName string
	jobName           string
}

func GetClient(ctx context.Context, logger *slog.Logger) (*Aca, error) {
	subscriptionId, err1 := requireEnv("SUBSCRIPTION_ID")
	resourceGroupName, err2 := requireEnv("RESOURCE_GROUP_NAME")
	jobName, err3 := requireEnv("JOB_NAME")

	if errors.Join(err1, err2, err3) != nil {
		return nil, errors.Join(err1, err2, err3)
	}
	cred, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return nil, err
	}
	client, err := armappcontainers.NewJobsClient(subscriptionId, cred, nil)
	if err != nil {
		return nil, err
	}

	return &Aca{
		ctx:               ctx,
		logger:            logger,
		client:            client,
		resourceGroupName: resourceGroupName,
		jobName:           jobName,
	}, nil
}

func (a *Aca) CurrentRunnerCount() (int, error) {
	return 0, fmt.Errorf("not implemented")
}

func (a *Aca) TriggerNewRunners(jitConfigs []string) (err error) {
	jobDefinition, err := a.client.Get(a.ctx, a.resourceGroupName, a.jobName, nil)
	if err != nil {
		return err
	}
	// Append JIT key to environment variables
	container := jobDefinition.Properties.Template.Containers[0]

	env := []*armappcontainers.EnvironmentVar{}

	for _, envVar := range container.Env {
		if *envVar.Name != "ACTIONS_RUNNER_INPUT_JITCONFIG" {
			env = append(env, envVar)
		}
	}

	var errorSlice []error

	for _, jitConfig := range jitConfigs {

		var jobStartOptions = &armappcontainers.JobsClientBeginStartOptions{
			Template: &armappcontainers.JobExecutionTemplate{
				Containers: []*armappcontainers.JobExecutionContainer{
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
					},
				},
			},
		}

		_, err = a.client.BeginStart(a.ctx, a.resourceGroupName, a.jobName, jobStartOptions)

		errorSlice = append(errorSlice, err)
	}

	return errors.Join(errorSlice...)
}

func (a *Aca) NeededRunners(jitConfigs []string) (err error) {
	return fmt.Errorf("not implemented")

}

func requireEnv(key string) (value string, err error) {
	value = os.Getenv(key)
	if len(value) == 0 {
		err = fmt.Errorf("value required for environment variable %s", key)
	}
	return
}
