// Command jib-notify-webhook sends event notifications via generic HTTP webhook.
package main

import (
	"encoding/json"
	"log"
	"os"

	"github.com/hexnickk/jib/internal/notify"
	"github.com/hexnickk/jib/internal/notifysvc"
)

func main() {
	channelName := notifysvc.EnvOr("CHANNEL_NAME", "webhook")
	credsPath := notifysvc.EnvOr("CREDS_FILE", "/opt/jib/secrets/_jib/"+channelName+".json")

	data, err := os.ReadFile(credsPath) //nolint:gosec // trusted creds path
	if err != nil {
		log.Fatalf("reading credentials from %s: %v", credsPath, err)
	}
	var creds struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(data, &creds); err != nil {
		log.Fatalf("parsing credentials: %v", err)
	}
	if creds.URL == "" {
		log.Fatal("url is required in credentials file")
	}

	notifysvc.Run(channelName, notify.NewWebhook(creds.URL))
}
