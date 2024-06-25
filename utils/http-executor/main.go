package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	}))
	startHealthCheck(logger)
}

func startHealthCheck(logger *slog.Logger) {
	http.HandleFunc("/", executeCommand)

	port, portSet := os.LookupEnv("PORT")
	if !portSet {
		port = "5000"
	}

	logger.Info(fmt.Sprintf("Serving at port %s", port))
	err := http.ListenAndServe(fmt.Sprintf(":%s", port), nil)
	if errors.Is(err, http.ErrServerClosed) {
		fmt.Printf("server closed\n")
	} else if err != nil {
		fmt.Printf("error starting server: %s\n", err)
		os.Exit(1)
	}
}

type payload struct {
	Command string   `json:"command"`
	Args    []string `json:"args"`
}

func executeCommand(w http.ResponseWriter, r *http.Request) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	}))
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if r.Header.Get("x-runner-token") != os.Getenv("RUNNER_TOKEN") {
		http.Error(w, "Invalid token provided", http.StatusUnauthorized)
		return
	}

	payload := &payload{}
	err := json.NewDecoder(r.Body).Decode(payload)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	logger.Debug(fmt.Sprintf("exeucting command: %s", payload.Command))
	output, err := exec.Command(payload.Command, payload.Args...).Output()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}

	w.WriteHeader(http.StatusCreated)
	w.Write(output)
}
