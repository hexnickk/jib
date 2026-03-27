package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Telegram sends notifications via the Telegram Bot API.
type Telegram struct {
	token  string
	chatID string
	client *http.Client
}

// NewTelegram creates a Telegram notifier with the given bot token and chat ID.
func NewTelegram(token, chatID string) *Telegram {
	return &Telegram{
		token:  token,
		chatID: chatID,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

// Name returns "telegram".
func (t *Telegram) Name() string { return "telegram" }

// Send posts a markdown-formatted message to the Telegram chat.
func (t *Telegram) Send(ctx context.Context, event Event) error {
	text := formatTelegram(event)

	payload, err := json.Marshal(map[string]string{
		"chat_id":    t.chatID,
		"text":       text,
		"parse_mode": "Markdown",
	})
	if err != nil {
		return fmt.Errorf("marshal telegram payload: %w", err)
	}

	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", t.token)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create telegram request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.client.Do(req)
	if err != nil {
		return fmt.Errorf("send telegram message: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("telegram API returned status %d", resp.StatusCode)
	}

	return nil
}

func formatTelegram(e Event) string {
	emoji := eventEmoji(e.Type)

	var msg string
	if e.App != "" {
		msg = fmt.Sprintf("%s *%s* %s", emoji, e.App, e.Type)
	} else {
		msg = fmt.Sprintf("%s %s", emoji, e.Type)
	}

	if e.SHA != "" {
		sha := e.SHA
		if len(sha) > 7 {
			sha = sha[:7]
		}
		msg += fmt.Sprintf(" `%s`", sha)
	}

	if e.Status != "" {
		msg += fmt.Sprintf(" — %s", e.Status)
	}

	if e.Trigger != "" {
		msg += fmt.Sprintf(" (%s)", e.Trigger)
	}

	if e.Error != "" {
		msg += fmt.Sprintf("\n⚠️ %s", e.Error)
	}

	return msg
}

func eventEmoji(eventType string) string {
	switch eventType {
	case "deploy":
		return "🚀"
	case "rollback":
		return "⏪"
	case "restart":
		return "🔄"
	case "backup":
		return "💾"
	case "cert_expiry":
		return "🔐"
	case "disk_warning":
		return "💿"
	case "container_crash":
		return "💥"
	case "serve_status":
		return "🖥"
	case "autodeploy_paused":
		return "⏸"
	default:
		return "📋"
	}
}
