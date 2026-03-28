// Command jib-notify is a standalone notification service.
// It subscribes to NATS events and forwards them to configured
// notification channels (Telegram, Slack, Discord, webhook).
package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hexnickk/jib/internal/bus"
	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/notify"
)

func main() {
	logger := log.New(os.Stderr, "[notify] ", log.LstdFlags)

	configPath := envOr("JIB_CONFIG", "/opt/jib/config.yml")
	secretsDir := envOr("JIB_SECRETS", "/opt/jib/secrets")
	natsURL := envOr("NATS_URL", bus.DefaultURL)
	natsUser := os.Getenv("NATS_USER")
	natsPass := os.Getenv("NATS_PASS")

	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		logger.Fatalf("loading config: %v", err)
	}

	// Build notifier from config.
	var notifier *notify.Multi
	if len(cfg.Notifications) > 0 {
		channels := make(map[string]notify.ChannelConfig, len(cfg.Notifications))
		for name, ch := range cfg.Notifications {
			channels[name] = notify.ChannelConfig{Driver: ch.Driver}
		}
		notifier = notify.LoadChannels(secretsDir, channels)
	} else {
		notifier = notify.LoadFromSecrets(secretsDir)
	}

	if len(notifier.ChannelNames()) == 0 {
		logger.Println("no notification channels configured, waiting for config change...")
	} else {
		logger.Printf("channels: %v", notifier.ChannelNames())
	}

	// Build per-app routing from config.
	appChannels := make(map[string][]string)
	for name, app := range cfg.Apps {
		if len(app.Notify) > 0 {
			appChannels[name] = app.Notify
		}
	}

	b, err := bus.Connect(bus.Options{
		URL:      natsURL,
		User:     natsUser,
		Password: natsPass,
	}, logger)
	if err != nil {
		logger.Fatalf("connecting to NATS: %v", err)
	}
	defer b.Close()

	handler := &eventHandler{
		notifier:    notifier,
		appChannels: appChannels,
		logger:      logger,
	}

	// Subscribe to all events.
	if _, err := b.Subscribe(bus.SubAllEvents, handler.handle); err != nil {
		logger.Fatalf("subscribing to events: %v", err)
	}
	logger.Printf("subscribed to %s", bus.SubAllEvents)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	<-ctx.Done()
	logger.Println("stopped")
}

type eventHandler struct {
	notifier    *notify.Multi
	appChannels map[string][]string // app name → channel names
	logger      *log.Logger
}

func (h *eventHandler) handle(subject string, data []byte) error {
	// Try to extract app name and build a notify.Event from the NATS message.
	event, channels := h.parseEvent(subject, data)
	if event == nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if len(channels) > 0 {
		if err := h.notifier.SendTo(ctx, channels, *event); err != nil {
			h.logger.Printf("send error: %v", err)
		}
	} else {
		if err := h.notifier.Send(ctx, *event); err != nil {
			h.logger.Printf("send error: %v", err)
		}
	}
	return nil
}

func (h *eventHandler) parseEvent(subject string, data []byte) (*notify.Event, []string) {
	// Parse the raw message to detect the type.
	var raw struct {
		App      string `json:"app"`
		Domain   string `json:"domain"`
		Status   string `json:"status"`
		SHA      string `json:"sha"`
		Trigger  string `json:"trigger"`
		User     string `json:"user"`
		Error    string `json:"error"`
		Endpoint string `json:"endpoint"`
		DaysLeft int    `json:"days_left"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		h.logger.Printf("invalid event on %s: %v", subject, err)
		return nil, nil
	}

	// Determine event type from subject prefix.
	var eventType string
	switch {
	case len(subject) >= len(bus.TopicDeployEvent) && subject[:len(bus.TopicDeployEvent)] == bus.TopicDeployEvent:
		eventType = "deploy"
	case len(subject) >= len(bus.TopicHealthEvent) && subject[:len(bus.TopicHealthEvent)] == bus.TopicHealthEvent:
		eventType = "health_check"
	case len(subject) >= len(bus.TopicCertEvent) && subject[:len(bus.TopicCertEvent)] == bus.TopicCertEvent:
		eventType = "cert_expiry"
	case len(subject) >= len(bus.TopicBackupEvent) && subject[:len(bus.TopicBackupEvent)] == bus.TopicBackupEvent:
		eventType = "backup"
	default:
		return nil, nil // unknown event type, skip
	}

	event := &notify.Event{
		App:       raw.App,
		Type:      eventType,
		SHA:       raw.SHA,
		Trigger:   raw.Trigger,
		User:      raw.User,
		Status:    raw.Status,
		Error:     raw.Error,
		Timestamp: time.Now(),
	}

	// For cert events, use domain as app identifier.
	if event.App == "" && raw.Domain != "" {
		event.App = raw.Domain
	}

	// Lookup per-app channel routing.
	channels := h.appChannels[event.App]
	return event, channels
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
