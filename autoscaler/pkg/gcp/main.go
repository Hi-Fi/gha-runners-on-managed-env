package gcp

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"

	run "cloud.google.com/go/run/apiv2"
	"cloud.google.com/go/run/apiv2/runpb"
)

type Cr struct {
	ctx     context.Context
	logger  *slog.Logger
	client  *run.JobsClient
	jobName string
}

func GetClient(ctx context.Context, logger *slog.Logger) (*Cr, error) {
	jobName, err1 := requireEnv("JOB_NAME")

	if errors.Join(err1) != nil {
		return nil, errors.Join(err1)
	}

	client, err := run.NewJobsClient(ctx)
	if err != nil {
		return nil, err
	}

	return &Cr{
		ctx:     ctx,
		logger:  logger,
		client:  client,
		jobName: jobName,
	}, nil
}

func (c *Cr) CurrentRunnerCount() (int, error) {
	return 0, fmt.Errorf("not implemented")
}

func (c *Cr) TriggerNewRunners(count int, jitConfig string) (err error) {
	req := &runpb.RunJobRequest{
		Name: c.jobName,
		Overrides: &runpb.RunJobRequest_Overrides{
			ContainerOverrides: []*runpb.RunJobRequest_Overrides_ContainerOverride{
				{
					Env: []*runpb.EnvVar{
						{
							Name:   "ACTIONS_RUNNER_INPUT_JITCONFIG",
							Values: &runpb.EnvVar_Value{Value: jitConfig},
						},
					},
				},
			},
		},
	}
	_, err = c.client.RunJob(c.ctx, req)

	return err
}

func (c *Cr) NeededRunners(count int, jitConfig string) (err error) {
	return fmt.Errorf("not implemented")

}

func requireEnv(key string) (value string, err error) {
	value = os.Getenv(key)
	if len(value) == 0 {
		err = fmt.Errorf("value required for environment variable %s", key)
	}
	return
}
