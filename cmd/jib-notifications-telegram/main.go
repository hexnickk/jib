// Command jib-notify-telegram sends event notifications via Telegram.
package main

import (
	"encoding/json"
	"log"
	"os"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/notify"
	"github.com/hexnickk/jib/internal/notifysvc"
)

func main() {
	channelName := notifysvc.EnvOr("CHANNEL_NAME", "telegram")
	credsPath := notifysvc.EnvOr("CREDS_FILE", config.JibSecretsDir()+"/"+channelName+".json")

	data, err := os.ReadFile(credsPath) //nolint:gosec // trusted creds path
	if err != nil {
		log.Fatalf("reading credentials from %s: %v", credsPath, err)
	}
	var creds struct {
		BotToken string `json:"bot_token"`
		ChatID   string `json:"chat_id"`
	}
	if err := json.Unmarshal(data, &creds); err != nil {
		log.Fatalf("parsing credentials: %v", err)
	}
	if creds.BotToken == "" || creds.ChatID == "" {
		log.Fatal("bot_token and chat_id are required in credentials file")
	}

	notifysvc.Run(channelName, notify.NewTelegram(creds.BotToken, creds.ChatID))
}
