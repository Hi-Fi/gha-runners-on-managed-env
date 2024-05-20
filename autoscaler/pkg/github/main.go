package github

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/actions/actions-runner-controller/github/actions"
	"github.com/google/uuid"
)

func CreateActionsServiceClient(pat string) *actions.Client {
	creds := actions.ActionsAuth{
		Token: pat,
	}

	actionsServiceClient, err := actions.NewClient("https://github.com/Hi-Fi/gha-runners-on-managed-env", &creds)
	if err != nil {
		log.Fatal(err.Error())
	}

	return actionsServiceClient
}

func CreateRunnerScaleSet(ctx context.Context, actionsServiceClient *actions.Client, scaleSetName string) *actions.RunnerScaleSet {
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
	createScaleSet, err := actionsServiceClient.CreateRunnerScaleSet(ctx, &runnerScaleSet)
	if err != nil {
		log.Fatal(err.Error())
	}
	return createScaleSet
}

func DeleteRunnerScaleSet(ctx context.Context, actionsServiceClient *actions.Client, runnerScaleSetId int) {
	actionsServiceClient.DeleteRunnerScaleSet(ctx, runnerScaleSetId)
}

func deleteMessageSession(ctx context.Context, actionsServiceClient *actions.Client, runnerScaleSetId int, sessionId *uuid.UUID) {
	actionsServiceClient.DeleteMessageSession(ctx, runnerScaleSetId, sessionId)
}

func StartMessagePolling(ctx context.Context, actionsServiceClient *actions.Client, runnerScaleSetId int, handler TriggerHandler) error {
	hostname, err := os.Hostname()
	if err != nil {
		hostname = uuid.NewString()
		fmt.Printf("Hostname set to uuid %s\n", hostname)
	}
	session, err := actionsServiceClient.CreateMessageSession(ctx, runnerScaleSetId, hostname)
	if err != nil {
		log.Fatalf("Could not get session, error %v", err)
	}

	defer deleteMessageSession(ctx, actionsServiceClient, runnerScaleSetId, session.SessionId)

	var lastMessageId int64 = 0
	for {
		fmt.Println("waiting for message...")
		select {
		case <-ctx.Done():
			fmt.Println("service is stopped.")
			return nil
		default:
			// Latest released version doesn't allow fetching more than one message at the time diretly. Building code for that as PoC.
			message, _ := actionsServiceClient.GetMessage(ctx, session.MessageQueueUrl, session.MessageQueueAccessToken, lastMessageId)
			if message == nil {
				continue
			}
			if message.MessageType != "RunnerScaleSetJobMessages" {
				fmt.Printf("Skipping message of type %s\n", message.MessageType)
				lastMessageId = message.MessageId
				continue
			}

			var rawMessages []json.RawMessage

			if len(message.Body) > 0 {
				if err := json.Unmarshal([]byte(message.Body), &rawMessages); err != nil {
					lastMessageId = message.MessageId
					fmt.Printf("Unmarshalling of message body to RawMessage failed: %w", err)
				}
			}

			var requestIds []int64
			for _, rawMessage := range rawMessages {
				var messageType actions.JobMessageType
				if err := json.Unmarshal(rawMessage, &messageType); err != nil {
					fmt.Printf("Failed to parse job message type: %w", err)
					lastMessageId = message.MessageId
					continue
				}

				// We are interested only on JobAvailable messages
				if messageType.MessageType == "JobAvailable" {
					var jobAvailable actions.JobAvailable
					if err := json.Unmarshal(rawMessage, &jobAvailable); err != nil {
						fmt.Printf("Failed to unmarshal message to job available: %w", err)
						lastMessageId = message.MessageId
						continue
					}
					requestIds = append(requestIds, jobAvailable.RunnerRequestId)
				} else {
					fmt.Printf("Not parsing message %s", messageType.MessageType)
				}
			}

			err := handler.NeededRunners(message.Statistics.TotalAcquiredJobs + message.Statistics.TotalRunningJobs + message.Statistics.TotalAssignedJobs + message.Statistics.TotalAvailableJobs)

			if err == nil {
				lastMessageId = message.MessageId
				actionsServiceClient.AcquireJobs(ctx, runnerScaleSetId, session.MessageQueueAccessToken, requestIds)
				actionsServiceClient.DeleteMessage(ctx, session.MessageQueueUrl, session.MessageQueueAccessToken, message.MessageId)
			} else {
				fmt.Println(err)
			}
		}
	}
}
