// Package notifysvc provides the shared runtime for jib notification services.
// Each per-driver service (jib-notify-telegram, jib-notify-slack, etc.)
// creates a notify.Notifier and calls Run() to start the event loop.
package notifysvc

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/hexnickk/jib/internal/bus"
	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/notify"
)

// Run starts the notification service event loop. It subscribes to all NATS
// events and routes them through the given notifier. channelName is the
// notification channel name used for per-app routing (matches app.notify config).
func Run(channelName string, notifier notify.Notifier) {
	logger := log.New(os.Stderr, "[notify-"+channelName+"] ", log.LstdFlags)

	configPath := EnvOr("JIB_CONFIG", "/opt/jib/config.yml")
	natsURL := EnvOr("NATS_URL", bus.DefaultURL)
	natsUser := os.Getenv("NATS_USER")
	natsPass := os.Getenv("NATS_PASS")

	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		logger.Fatalf("loading config: %v", err)
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

	// Build per-app routing: which apps include this channel in their notify list.
	appSet := make(map[string]bool)
	for name, app := range cfg.Apps {
		for _, ch := range app.Notify {
			if ch == channelName {
				appSet[name] = true
			}
		}
	}

	handler := &eventHandler{
		channelName: channelName,
		notifier:    notifier,
		appSet:      appSet,
		logger:      logger,
	}

	if _, err := b.Subscribe(bus.SubAllEvents, handler.handle); err != nil {
		logger.Fatalf("subscribing: %v", err)
	}
	logger.Printf("subscribed to %s (channel: %s)", bus.SubAllEvents, channelName)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	<-ctx.Done()
	logger.Println("stopped")
}

// EnvOr returns the value of the env var or the fallback.
func EnvOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

type eventHandler struct {
	channelName string
	notifier    notify.Notifier
	appSet      map[string]bool // apps that route to this channel
	logger      *log.Logger
}

func (h *eventHandler) handle(_ string, data []byte) error {
	event := h.parseEvent(data)
	if event == nil {
		return nil
	}

	// Skip events for apps that don't route to this channel.
	// If appSet is empty (no per-app routing), notify for all events.
	if len(h.appSet) > 0 && !h.appSet[event.App] {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := h.notifier.Send(ctx, *event); err != nil {
		h.logger.Printf("send error: %v", err)
	}
	return nil
}

func (h *eventHandler) parseEvent(data []byte) *notify.Event {
	var raw struct {
		App     string `json:"app"`
		Domain  string `json:"domain"`
		Status  string `json:"status"`
		SHA     string `json:"sha"`
		Trigger string `json:"trigger"`
		User    string `json:"user"`
		Error   string `json:"error"`
		Source  string `json:"source"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}

	// Detect event type from source + status.
	eventType := raw.Source
	if strings.Contains(raw.Source, "health") {
		eventType = "health_check"
	} else if strings.Contains(raw.Source, "cert") {
		eventType = "cert_expiry"
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

	if event.App == "" && raw.Domain != "" {
		event.App = raw.Domain
	}

	return event
}
