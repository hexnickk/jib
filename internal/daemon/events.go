package daemon

import (
	"context"
	"time"

	"github.com/hexnickk/jib/internal/bus"
	"github.com/hexnickk/jib/internal/deploy"
)

const heartbeatInterval = 30 * time.Second

// publishDeployEvent publishes a deploy result to the NATS bus.
func (d *Daemon) publishDeployEvent(result *deploy.DeployResult, trigger, user, correlationID string, duration time.Duration) {
	status := bus.StatusSuccess
	if !result.Success {
		status = bus.StatusFailure
	}
	ev := bus.DeployEvent{
		Message:     bus.NewCorrelated("daemon", correlationID),
		App:         result.App,
		SHA:         result.DeployedSHA,
		PreviousSHA: result.PreviousSHA,
		Strategy:    result.Strategy,
		Status:      status,
		Trigger:     trigger,
		User:        user,
		Error:       result.Error,
		DurationMs:  duration.Milliseconds(),
	}
	d.publish(ev.Subject(), ev)
}

// publish is a helper that nil-checks the bus and logs errors.
func (d *Daemon) publish(subject string, msg interface{}) {
	if d.bus == nil {
		return
	}
	if err := d.bus.Publish(subject, msg); err != nil {
		d.logger.Printf("bus: publish to %s: %v", subject, err)
	}
}

// runHeartbeat publishes periodic heartbeat messages.
func (d *Daemon) runHeartbeat(ctx context.Context) {
	d.publishHeartbeatOnce()

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			d.publishHeartbeatOnce()
		case <-ctx.Done():
			return
		}
	}
}

func (d *Daemon) publishHeartbeatOnce() {
	cfg := d.getConfig()
	apps := make([]string, 0, len(cfg.Apps))
	for name := range cfg.Apps {
		apps = append(apps, name)
	}
	hb := bus.Heartbeat{
		Message: bus.NewMessage("daemon"),
		Apps:    apps,
		Uptime:  int64(time.Since(d.startTime).Seconds()),
	}
	d.publish(hb.Subject(), hb)
}
