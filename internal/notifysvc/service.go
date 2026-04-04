// Package notifysvc provides the shared runtime for the jib-notifier service.
// It subscribes to NATS events and routes them to the correct notification
// channels based on each app's notify list in the config.
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
// events and routes them to the appropriate channels based on each app's
// notify list in the config.
func Run(multi *notify.Multi, cfg *config.Config) {
	logger := log.New(os.Stderr, "[notifier] ", log.LstdFlags)

	natsURL := EnvOr("NATS_URL", bus.DefaultURL)
	natsUser := os.Getenv("NATS_USER")
	natsPass := os.Getenv("NATS_PASS")

	b, err := bus.Connect(bus.Options{
		URL:      natsURL,
		User:     natsUser,
		Password: natsPass,
	}, logger)
	if err != nil {
		logger.Fatalf("connecting to NATS: %v", err)
	}
	defer b.Close()

	// Build per-app notify routing from config.
	appNotify := make(map[string][]string)
	for name, app := range cfg.Apps {
		if len(app.Notify) > 0 {
			appNotify[name] = app.Notify
		}
	}

	handler := &eventHandler{
		multi:     multi,
		appNotify: appNotify,
		logger:    logger,
	}

	if _, err := b.Subscribe(bus.SubAllEvents, handler.handle); err != nil {
		logger.Fatalf("subscribing: %v", err)
	}
	logger.Printf("subscribed to %s (channels: %s)", bus.SubAllEvents, strings.Join(multi.ChannelNames(), ", "))

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
	multi     *notify.Multi
	appNotify map[string][]string // app name → channel names
	logger    *log.Logger
}

func (h *eventHandler) handle(subject string, data []byte) error {
	event := h.parseEvent(subject, data)
	if event == nil {
		return nil
	}

	notifyList := h.appNotify[event.App]
	if len(notifyList) == 0 {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := h.multi.SendForApp(ctx, notifyList, *event); err != nil {
		h.logger.Printf("send error: %v", err)
	}
	return nil
}

func (h *eventHandler) parseEvent(subject string, data []byte) *notify.Event {
	var raw struct {
		App     string `json:"app"`
		Domain  string `json:"domain"`
		Status  string `json:"status"`
		SHA     string `json:"sha"`
		Trigger string `json:"trigger"`
		User    string `json:"user"`
		Error   string `json:"error"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}

	// Detect event type from NATS subject prefix.
	var eventType string
	switch {
	case strings.HasPrefix(subject, bus.TopicDeployEvent+"."):
		eventType = "deploy"
	case strings.HasPrefix(subject, bus.TopicHealthEvent+"."):
		eventType = "health_check"
	default:
		return nil
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
