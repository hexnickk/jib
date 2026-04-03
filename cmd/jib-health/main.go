// Command jib-health is a standalone health monitor service.
// It periodically checks HTTP health endpoints for all apps
// and publishes health events to NATS.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hexnickk/jib/internal/bus"
	"github.com/hexnickk/jib/internal/config"
)

const checkInterval = 60 * time.Second

func main() {
	logger := log.New(os.Stderr, "[health] ", log.LstdFlags)

	configPath := envOr("JIB_CONFIG", config.ConfigFile())
	natsURL := envOr("NATS_URL", bus.DefaultURL)
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

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	monitor := &healthMonitor{
		cfg:    cfg,
		bus:    b,
		client: &http.Client{Timeout: 5 * time.Second},
		logger: logger,
		state:  make(map[string]bool), // endpoint → healthy
	}

	logger.Println("started")

	// Wait before first check so apps have time to start.
	select {
	case <-time.After(30 * time.Second):
	case <-ctx.Done():
		return
	}

	// Check immediately, then on interval.
	monitor.checkAll(ctx)

	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			monitor.checkAll(ctx)
		case <-ctx.Done():
			logger.Println("stopped")
			return
		}
	}
}

type healthMonitor struct {
	cfg    *config.Config
	bus    *bus.Bus
	client *http.Client
	logger *log.Logger
	state  map[string]bool // endpoint → last known healthy state
}

func (m *healthMonitor) checkAll(ctx context.Context) {
	for appName, appCfg := range m.cfg.Apps {
		if ctx.Err() != nil {
			return
		}
		for _, check := range appCfg.Health {
			if ctx.Err() != nil {
				return
			}
			endpoint := fmt.Sprintf("http://localhost:%d%s", check.Port, check.Path)
			healthy := m.checkOne(ctx, endpoint)
			wasHealthy, known := m.state[endpoint]

			if known && wasHealthy && !healthy {
				// Transition: healthy → unhealthy
				m.logger.Printf("%s: unhealthy (%s)", appName, endpoint)
				m.publishEvent(appName, endpoint, bus.StatusFailed, fmt.Sprintf("health check failed: %s", endpoint))
			} else if known && !wasHealthy && healthy {
				// Transition: unhealthy → recovered
				m.logger.Printf("%s: recovered (%s)", appName, endpoint)
				m.publishEvent(appName, endpoint, bus.StatusRecovered, "")
			} else if !known && !healthy {
				// First check and already unhealthy
				m.logger.Printf("%s: unhealthy (%s)", appName, endpoint)
				m.publishEvent(appName, endpoint, bus.StatusFailed, fmt.Sprintf("health check failed: %s", endpoint))
			}

			m.state[endpoint] = healthy
		}
	}
}

func (m *healthMonitor) checkOne(ctx context.Context, endpoint string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return false
	}
	resp, err := m.client.Do(req)
	if err != nil {
		return false
	}
	_ = resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

func (m *healthMonitor) publishEvent(app, endpoint, status, errMsg string) {
	ev := bus.HealthEvent{
		Message:  bus.NewMessage("health"),
		App:      app,
		Endpoint: endpoint,
		Status:   status,
		Error:    errMsg,
	}
	if err := m.bus.Publish(ev.Subject(), ev); err != nil {
		m.logger.Printf("publish error: %v", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
