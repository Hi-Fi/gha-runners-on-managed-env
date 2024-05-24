package aws

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ecs"
	"github.com/aws/aws-sdk-go-v2/service/ecs/types"
)

type Ecs struct {
	ctx               context.Context
	logger            *slog.Logger
	client            *ecs.Client
	taskDefinitionArn *string
	starter           *string
	cluster           *string
	subnets           []string
	securityGroups    []string
}

func GetClient(ctx context.Context, logger *slog.Logger) (*Ecs, error) {
	taskDefinitionArn, err1 := requireEnv("TASK_DEFINITION_ARN")
	cluster, err2 := requireEnv("ECS_CLUSTER")
	subnets, err3 := requireEnv("ECS_SUBNETS")
	securityGroups, err4 := requireEnv("ECS_SECURITY_GROUPS")
	if errors.Join(err1, err2, err3, err4) != nil {
		return nil, errors.Join(err1, err2, err3, err4)
	}
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, err
	}

	client := ecs.NewFromConfig(cfg)

	return &Ecs{
		ctx:               ctx,
		logger:            logger,
		client:            client,
		taskDefinitionArn: &taskDefinitionArn,
		cluster:           &cluster,
		subnets:           strings.Split(subnets, ","),
		securityGroups:    strings.Split(securityGroups, ","),
		starter:           aws.String("action-runner-scaler"),
	}, nil
}

func (e *Ecs) CurrentRunnerCount() (int, error) {
	var taskCount int = 0
	var err error
	var nextToken *string
	for {
		input := &ecs.ListTasksInput{
			StartedBy: e.starter,
			NextToken: nextToken,
			Cluster:   e.cluster,
		}
		tasks, err := e.client.ListTasks(e.ctx, input)
		if err != nil {
			break
		}
		taskCount = taskCount + len(tasks.TaskArns)
		if tasks.NextToken == nil {
			break
		}
		nextToken = tasks.NextToken
	}

	return taskCount, err
}

func (e *Ecs) TriggerNewRunners(count int, jitConfig string) (err error) {
	var errs []error
	for i := 0; i < int(math.Ceil(float64(count)/10)); i++ {
		starts := count - 10*i

		if starts > 10 {
			starts = 10
		}

		e.logger.Debug(fmt.Sprintf("Triggering %d runners in batch", starts))

		input := &ecs.RunTaskInput{
			StartedBy:      e.starter,
			TaskDefinition: e.taskDefinitionArn,
			Count:          aws.Int32(int32(starts)),
			Cluster:        e.cluster,
			LaunchType:     types.LaunchTypeFargate,
			NetworkConfiguration: &types.NetworkConfiguration{
				AwsvpcConfiguration: &types.AwsVpcConfiguration{
					Subnets:        e.subnets,
					SecurityGroups: e.securityGroups,
					AssignPublicIp: types.AssignPublicIpEnabled,
				},
			},
			Overrides: &types.TaskOverride{
				ContainerOverrides: []types.ContainerOverride{
					{
						Name: aws.String("runner"),
						Environment: []types.KeyValuePair{
							{
								Name:  aws.String("ACTIONS_RUNNER_INPUT_JITCONFIG"),
								Value: &jitConfig,
							},
						},
					},
				},
			},
		}

		_, err := e.client.RunTask(e.ctx, input)
		if err != nil {
			errs = append(errs, err)
		}
	}

	return errors.Join(errs...)
}

func (e *Ecs) NeededRunners(count int, jitConfig string) (err error) {
	currentRunners, err := e.CurrentRunnerCount()
	if err != nil {
		return err
	}
	e.logger.Debug(fmt.Sprintf("%d/%d of runners available", currentRunners, count))
	if count-currentRunners > 0 {
		e.logger.Debug(fmt.Sprintf("Triggering %d runners", count-currentRunners))
		return e.TriggerNewRunners(count-currentRunners, jitConfig)
	}

	return nil
}

func requireEnv(key string) (value string, err error) {
	value = os.Getenv(key)
	if len(value) == 0 {
		err = fmt.Errorf("value required for environment variable %s", key)
	}
	return
}
