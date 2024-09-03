package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"

	"github.com/fsnotify/fsnotify"
	"github.com/gohugoio/hugo/watcher/filenotify"
)

type CommandResponse struct {
	ReturnCode int    `json:"returnCode"`
	ErrorLogs  string `json:"errorLogs"`
}

func waitForCommands(watcher filenotify.FileWatcher) {
	log.Println("Starting to watch directory")

	var executedCommands *[]string

	go func() {
		for {
			select {
			case event := <-watcher.Events():

				if event.Has(fsnotify.Create) {
					log.Printf("File %s written\n", event.Name)
					if strings.HasSuffix(event.Name, ".sh") && !slices.Contains(*executedCommands, event.Name) {
						*executedCommands = append(*executedCommands, event.Name)
						os.Chmod(event.Name, 0777)
						executeCommand(event.Name)
					} else {
						log.Printf("File %s was either handled or with invalid extension", event.Name)
					}
				}
			case err := <-watcher.Errors():
				log.Println("error:", err)
			}
		}
	}()

	// Block main goroutine forever.
	<-make(chan struct{})
}

func executeCommand(command string) ([]byte, error) {
	log.Printf("Executing command %s", command)
	commandContent, _ := os.ReadFile(command)
	log.Println(string(commandContent))
	output, err := exec.Command("/bin/sh", command).Output()
	if err != nil {
		fmt.Printf("Some error happened. Error: %s\n", err.Error())
	}
	log.Println("Execution completed")
	log.Println(string(output))
	log.Printf("Writing logs to %s.log", command)
	os.WriteFile(fmt.Sprintf("%s.log", command), output, 0777)
	return output, err
}

func main() {
	watchDir := "/__w/_temp/"
	// Create new watcher.
	watcher := filenotify.NewPollingWatcher(5)

	defer watcher.Close()
	files, err := os.ReadDir(watchDir)
	if err != nil {
		log.Fatal(err)
	}
	for _, file := range files {
		if strings.HasSuffix(file.Name(), ".sh") {
			log.Printf("Handling existing file %s", file.Name())
			executeCommand(filepath.Join(watchDir, file.Name()))
		}
	}
	watcher.Add(watchDir)
	waitForCommands(watcher)
}
