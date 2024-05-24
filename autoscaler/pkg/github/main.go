package github

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"log/slog"
	"os"
	"strings"

	"github.com/actions/actions-runner-controller/github/actions"
	"github.com/google/uuid"
)

type ActionsServiceClient struct {
	ctx    context.Context
	Client *actions.Client
	logger *slog.Logger
}

func CreateActionsServiceClient(ctx context.Context, pat string, logger *slog.Logger) *ActionsServiceClient {
	creds := actions.ActionsAuth{
		Token: pat,
	}

	actionsServiceClient, err := actions.NewClient("https://github.com/Hi-Fi/gha-runners-on-managed-env", &creds)
	if err != nil {
		log.Fatal(err.Error())
	}

	return &ActionsServiceClient{
		ctx:    ctx,
		Client: actionsServiceClient,
		logger: logger,
	}
}

func (asc *ActionsServiceClient) CreateRunnerScaleSet(scaleSetName string) *actions.RunnerScaleSet {
	runnerScaleSet := actions.RunnerScaleSet{
		Name:          scaleSetName,
		RunnerGroupId: 1,
		RunnerSetting: actions.RunnerSetting{
			Ephemeral:     true,
			DisableUpdate: true,
		},
		Labels: []actions.Label{
			{
				Name: scaleSetName,
				Type: "System",
			},
		},
	}
	createScaleSet, err := asc.Client.CreateRunnerScaleSet(asc.ctx, &runnerScaleSet)
	if err != nil {
		log.Fatal(err.Error())
	}
	return createScaleSet
}

func (asc *ActionsServiceClient) DeleteRunnerScaleSet(runnerScaleSetId int) {
	asc.logger.Info(fmt.Sprintf("Removing runner scaleset %d\n", runnerScaleSetId))
	asc.Client.DeleteRunnerScaleSet(asc.ctx, runnerScaleSetId)
}

func (asc *ActionsServiceClient) StartMessagePolling(runnerScaleSetId int, handler TriggerHandler) error {
	hostname, err := os.Hostname()
	if err != nil {
		hostname = uuid.NewString()
		fmt.Printf("Hostname set to uuid %s\n", hostname)
	}
	session, err := asc.Client.CreateMessageSession(asc.ctx, runnerScaleSetId, hostname)
	if err != nil {
		asc.logger.Error("Could not get session", slog.Any("err", err))
		return err
	}

	defer asc.Client.DeleteMessageSession(context.Background(), runnerScaleSetId, session.SessionId)

	var lastMessageId int64 = 0
	for {
		asc.logger.Debug("waiting for message...")
		select {
		case <-asc.ctx.Done():
			asc.logger.Info("service is stopped.")
			return nil
		default:
			// Latest released version doesn't allow fetching more than one message at the time diretly. Building code for that as PoC.
			message, _ := asc.Client.GetMessage(asc.ctx, session.MessageQueueUrl, session.MessageQueueAccessToken, lastMessageId)
			if message == nil {
				continue
			}
			if message.MessageType != "RunnerScaleSetJobMessages" {
				asc.logger.Debug(fmt.Sprintf("Skipping message of type %s\n", message.MessageType))
				lastMessageId = message.MessageId
				continue
			}

			var rawMessages []json.RawMessage

			if len(message.Body) > 0 {
				if err := json.Unmarshal([]byte(message.Body), &rawMessages); err != nil {
					lastMessageId = message.MessageId
					asc.logger.Warn("Unmarshalling of message body to RawMessage failed", slog.Any("err", err))
					continue
				}
			}

			var requestIds []int64
			for _, rawMessage := range rawMessages {
				var messageType actions.JobMessageType
				if err := json.Unmarshal(rawMessage, &messageType); err != nil {
					asc.logger.Warn("Failed to parse job message type", slog.Any("err", err))
					lastMessageId = message.MessageId
					continue
				}

				// We are interested only on JobAvailable messages
				if messageType.MessageType == "JobAvailable" {
					var jobAvailable actions.JobAvailable
					if err := json.Unmarshal(rawMessage, &jobAvailable); err != nil {
						asc.logger.Warn("Failed to unmarshal message to job available", slog.Any("err", err))
						lastMessageId = message.MessageId
						continue
					}
					requestIds = append(requestIds, jobAvailable.RunnerRequestId)
				} else {
					asc.logger.Debug(fmt.Sprintf("Not parsing message %s\n", messageType.MessageType))
					lastMessageId = message.MessageId
					continue
				}
			}

			if len(requestIds) == 0 {
				continue
			}

			fmt.Println("Getting JIT config")
			jitConfig, err := asc.Client.GenerateJitRunnerConfig(asc.ctx, &actions.RunnerScaleSetJitRunnerSetting{}, runnerScaleSetId)
			if err != nil {
				asc.logger.Warn("Could not get JIT config", slog.Any("err", err))
				continue
			}

			err = handler.TriggerNewRunners(1, jitConfig.EncodedJITConfig)

			if err == nil {
				asc.logger.Info("Runners requested succesfully, acquiring jobs message")
				lastMessageId = message.MessageId
				jobs, err := asc.Client.AcquireJobs(asc.ctx, runnerScaleSetId, session.MessageQueueAccessToken, requestIds)
				if err == nil {
					asc.logger.Info(fmt.Sprintf("Acquired jobs %s, removing message...\n", strings.Join(strings.Fields(fmt.Sprint(jobs)), ", ")))
					asc.Client.DeleteMessage(asc.ctx, session.MessageQueueUrl, session.MessageQueueAccessToken, message.MessageId)
				}

			} else {
				slog.Error("Triggering new runners faileded", slog.Any("err", err))
			}
		}
	}
}
