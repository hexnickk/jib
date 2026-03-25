package daemon

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/notify"
)

// healthCheckInterval is the time between health monitoring cycles.
const healthCheckInterval = 60 * time.Second

// runHealthMonitor periodically checks the health of all running apps.
func (d *Daemon) runHealthMonitor(ctx context.Context) {
	// Wait before first check so apps have time to start.
	select {
	case <-time.After(30 * time.Second):
	case <-ctx.Done():
		return
	}

	d.logger.Println("health: started")

	ticker := time.NewTicker(healthCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			d.checkAllHealth(ctx)
		case <-ctx.Done():
			d.logger.Println("health: stopped")
			return
		}
	}
}

// checkAllHealth checks health endpoints for all apps that have them configured.
func (d *Daemon) checkAllHealth(ctx context.Context) {
	cfg := d.getConfig()
	client := &http.Client{Timeout: 5 * time.Second}

	for appName, appCfg := range cfg.Apps {
		if ctx.Err() != nil {
			return
		}

		if len(appCfg.Health) == 0 {
			continue
		}

		for _, check := range appCfg.Health {
			if ctx.Err() != nil {
				return
			}

			endpoint := fmt.Sprintf("http://localhost:%d%s", check.Port, check.Path)
			ok := d.checkSingleHealth(ctx, client, endpoint)

			if !ok {
				d.logger.Printf("health: %s unhealthy (%s)", appName, endpoint)
				d.notifyHealth(ctx, appName, appCfg, endpoint)
			}
		}
	}
}

// checkSingleHealth performs a single HTTP health check. Returns true if healthy.
func (d *Daemon) checkSingleHealth(ctx context.Context, client *http.Client, endpoint string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return false
	}

	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()

	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

// notifyHealth sends a health check failure notification.
func (d *Daemon) notifyHealth(ctx context.Context, app string, appCfg config.App, endpoint string) {
	if d.notifier == nil {
		return
	}

	event := notify.Event{
		App:       app,
		Type:      "health_check",
		Status:    "failure",
		Error:     fmt.Sprintf("health check failed: %s", endpoint),
		Timestamp: time.Now(),
	}

	if len(appCfg.Notify) > 0 {
		_ = d.notifier.SendForApp(ctx, appCfg.Notify, event)
		return
	}
	_ = d.notifier.Send(ctx, event)
}
