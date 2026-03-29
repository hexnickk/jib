// Command jib-notify-slack sends event notifications via Slack.
package main

import (
	"encoding/json"
	"log"
	"os"

	"github.com/hexnickk/jib/internal/notify"
	"github.com/hexnickk/jib/internal/notifysvc"
)

func main() {
	channelName := notifysvc.EnvOr("CHANNEL_NAME", "slack")
	credsPath := notifysvc.EnvOr("CREDS_FILE", "/opt/jib/secrets/_jib/"+channelName+".json")

	data, err := os.ReadFile(credsPath) //nolint:gosec // trusted creds path
	if err != nil {
		log.Fatalf("reading credentials from %s: %v", credsPath, err)
	}
	var creds struct {
		WebhookURL string `json:"webhook_url"`
	}
	if err := json.Unmarshal(data, &creds); err != nil {
		log.Fatalf("parsing credentials: %v", err)
	}
	if creds.WebhookURL == "" {
		log.Fatal("webhook_url is required in credentials file")
	}

	notifysvc.Run(channelName, notify.NewSlack(creds.WebhookURL))
}
