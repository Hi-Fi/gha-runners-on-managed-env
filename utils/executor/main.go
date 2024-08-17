package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"github.com/hashicorp/go-retryablehttp"
)

func newClient() (*http.Client, error) {
	retryClient := retryablehttp.NewClient()
	retryClient.RetryMax = 4
	retryClient.RetryWaitMax = 30 * time.Second
	retryClient.HTTPClient.Timeout = 5 * time.Minute // timeout must be > 1m to accomodate long polling
	retryClient.StandardClient()

	return retryClient.StandardClient(), nil
}

type CommandResponse struct {
	ReturnCode int    `json:"returnCode"`
	ErrorLogs  string `json:"errorLogs"`
}

func waitForCommands(ctx context.Context, client *http.Client) {
	runnerHost, isSet := os.LookupEnv("RUNNER_HOST")
	if !isSet {
		fmt.Printf("RUNNER_HOST is mandatory for command execution")
		return
	}
	runnerPort, isSet := os.LookupEnv("RUNNER_PORT")
	if !isSet {
		fmt.Printf("RUNNER_PORT is mandatory for command execution")
		return
	}

	fmt.Printf("Starting to poll host %s:%s\n", runnerHost, runnerPort)
	for {
		select {
		case <-ctx.Done():
			return
		default:
			response, err := client.Get(fmt.Sprintf("http://%s:%s/poll", runnerHost, runnerPort))
			if err != nil {
				fmt.Printf("Error happened. Error: %s\n", err.Error())
				return
			}
			defer response.Body.Close()
			if response.StatusCode == http.StatusOK {
				bodyBytes, err := io.ReadAll(response.Body)
				if err != nil {
					fmt.Printf("Error happened. Error: %s\n", err.Error())
					return
				}
				command := string(bodyBytes)
				logs, err := executeCommand(command)
				client.Post(fmt.Sprintf("http://%s:%s/logs", runnerHost, runnerPort), "text/html; charset=utf-8", bytes.NewBuffer(logs))
				doneMessage := CommandResponse{
					ReturnCode: err.(*exec.ExitError).ExitCode(),
					ErrorLogs:  string(err.(*exec.ExitError).Stderr),
				}
				fmt.Printf("Execution of command %s ended. Sending response: %+v", command, doneMessage)
				payload, _ := json.Marshal(doneMessage)
				client.Post(fmt.Sprintf("http://%s:%s/done", runnerHost, runnerPort), "text/html; charset=utf-8", bytes.NewBuffer(payload))
			}
		}
	}
}

func executeCommand(command string) ([]byte, error) {
	output, err := exec.Command(command).Output()
	if err != nil {
		fmt.Printf("Some error happened. Error: %s\n", err.Error())
	}
	return output, err
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	client, _ := newClient()
	waitForCommands(ctx, client)
}
