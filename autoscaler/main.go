package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/hi-fi/gha-runners-on-managed-env/autoscaler/pkg/aws"
	"github.com/hi-fi/gha-runners-on-managed-env/autoscaler/pkg/github"
)

func main() {
	go startHealthCheck()
	pat, err := requireEnv("PAT")
	if err != nil {
		log.Fatal(err.Error())
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	client := github.CreateActionsServiceClient(pat)
	fmt.Println(client.ActionsServiceAdminToken)
	defer client.CloseIdleConnections()
	scaleSet, _ := client.GetRunnerScaleSet(ctx, 1, "local-runner-scale-set")
	fmt.Println(client.ActionsServiceAdminToken)
	fmt.Println(scaleSet)
	if scaleSet != nil {
		fmt.Printf("Using existing scale set %s (ID %x). Runner group id %x\n", scaleSet.Name, scaleSet.Id, scaleSet.RunnerGroupId)
	} else {
		fmt.Println("Creating new scale set")
		scaleSet = github.CreateRunnerScaleSet(ctx, client, "local-runner-scale-set")
		fmt.Printf("Created scale set %s (ID %x). Runner group id %x\n", scaleSet.Name, scaleSet.Id, scaleSet.RunnerGroupId)
	}

	ecsClient, err := aws.GetClient(ctx)

	if err == nil {
		github.StartMessagePolling(ctx, client, scaleSet.Id, ecsClient)
	}
}

func startHealthCheck() {
	http.HandleFunc("/", health)

	port := getenv("PORT", "5000")
	fmt.Printf("Healtcheck serving at port %s", port)
	err := http.ListenAndServe(fmt.Sprintf(":%s", port), nil)
	if errors.Is(err, http.ErrServerClosed) {
		fmt.Printf("server closed\n")
	} else if err != nil {
		fmt.Printf("error starting server: %s\n", err)
		os.Exit(1)
	}
}

func health(w http.ResponseWriter, _ *http.Request) {
	io.WriteString(w, "OK")
}

// func createRunnerScaleSet(pat string) {
// 	creds := actions.ActionsAuth{
// 		Token: pat,
// 	}

// 	actionsServiceClient, err := actions.NewClient("https://github.com/Hi-Fi/gha-runners-on-managed-env", &creds)
// 	if err != nil {
// 		log.Fatal(err.Error())
// 	}
// 	runnerScaleSet := actions.RunnerScaleSet{
// 		Name:          "local-runner-scale-set",
// 		RunnerGroupId: 1,
// 		Labels: []actions.Label{
// 			{
// 				Name: "aca",
// 				Type: "System",
// 			},
// 		},
// 		RunnerSetting: actions.RunnerSetting{
// 			Ephemeral:     true,
// 			DisableUpdate: true,
// 		},
// 	}
// 	_, err = actionsServiceClient.CreateRunnerScaleSet(context.TODO(), &runnerScaleSet)
// 	if err != nil {
// 		log.Fatal(err.Error())
// 	}

// 	// defer func() {
// 	// 	fmt.Printf("Removing scale set %s", returnScaleSet.Name)
// 	// 	actionsServiceClient.DeleteRunnerScaleSet(context.TODO(), returnScaleSet.Id)
// 	// }()

// 	fmt.Println("Starting messaging session")
// 	actionsServiceClient.CreateMessageSession(context.TODO(), runnerScaleSet.Id, "Hi-Fi")
// }

//	func pollActionNeed(client *github.Client) {
//		workflowRuns, err := client.ListRepositoryWorkflowRuns(context.TODO(), "Hi-Fi", "gha-runners-on-managed-env")
//		if err != nil {
//			log.Fatal(err.Error())
//		}
//		fmt.Println(workflowRuns)
//		for _, run := range workflowRuns {
//			fmt.Printf("Run %x: %s in status %s", *run.ID, *run.Name, *run.Status)
//		}
//	}
func requireEnv(key string) (value string, err error) {
	value = os.Getenv(key)
	if len(value) == 0 {
		err = errors.New(fmt.Sprintf("Value required for environment variable %s", key))
	}
	return
}

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if len(value) == 0 {
		return fallback
	}
	return value
}
