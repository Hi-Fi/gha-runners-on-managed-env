package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
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

	go func() {
		for {
			select {
			case event := <-watcher.Events():

				if event.Has(fsnotify.Create) {
					log.Printf("File %s written\n", event.Name)
					if strings.HasSuffix(event.Name, ".sh") {
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

func executeCommand(command string) {
	// Expect that command will succeed
	rc := 0

	defer writeCompletionFile(command, &rc)
	log.Printf("Executing command %s", command)
	commandContent, _ := os.ReadFile(command)
	log.Println(string(commandContent))
	outfile, err := os.Create(fmt.Sprintf("%s.log", command))
	if err != nil {
		fmt.Printf("Could not create output file. Error: %s\n", err.Error())
		rc = 1
		return
	}
	defer outfile.Close()
	execution := exec.Command("/bin/sh", command)
	execution.Stderr = outfile
	execution.Stdout = outfile

	err = execution.Run()
	if err != nil {
		fmt.Printf("Some error happened. Error: %s\n", err.Error())
		rc = 1
	}
}

func writeCompletionFile(command string, rc *int) {
	log.Println("Execution completed")
	log.Printf("Writing return code %d to %s.rc", *rc, command)
	os.WriteFile(fmt.Sprintf("%s.rc", command), []byte(fmt.Sprintf("%d ", *rc)), 0777)
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
