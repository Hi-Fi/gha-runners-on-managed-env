package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/hi-fi/gha-runners-on-managed-env/autoscaler/pkg/gcp"
	"github.com/hi-fi/gha-runners-on-managed-env/autoscaler/pkg/github"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	}))
	go startHealthCheck(logger)
	pat, err := requireEnv("PAT")
	if err != nil {
		log.Fatal(err.Error())
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	scaleSetName := getenv("SCALE_SET_NAME", "local-runner-scale-set")
	client := github.CreateActionsServiceClient(ctx, pat, logger)
	defer client.Client.CloseIdleConnections()
	scaleSet, _ := client.Client.GetRunnerScaleSet(ctx, 1, scaleSetName)
	if scaleSet != nil {
		logger.Info(fmt.Sprintf("Using existing scale set %s (ID %x). Runner group id %x", scaleSet.Name, scaleSet.Id, scaleSet.RunnerGroupId))
	} else {
		logger.Debug("Creating new scale set")
		scaleSet = client.CreateRunnerScaleSet(scaleSetName)
		logger.Info(fmt.Sprintf("Created scale set %s (ID %x). Runner group id %x", scaleSet.Name, scaleSet.Id, scaleSet.RunnerGroupId))
	}

	crClient, err := gcp.GetClient(ctx, logger)

	if err == nil {
		client.StartMessagePolling(scaleSet.Id, crClient)
	} else {
		logger.Error("Client creation failed.", slog.Any("err", err))
	}
}

func startHealthCheck(logger *slog.Logger) {
	http.HandleFunc("/", health)

	port := getenv("PORT", "5000")
	logger.Info(fmt.Sprintf("Healtcheck serving at port %s", port))
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

func requireEnv(key string) (value string, err error) {
	value = os.Getenv(key)
	if len(value) == 0 {
		err = fmt.Errorf(fmt.Sprintf("Value required for environment variable %s", key))
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
