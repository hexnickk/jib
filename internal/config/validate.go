package config

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// ValidationErrors collects multiple validation problems.
type ValidationErrors struct {
	Errors []string
}

func (ve *ValidationErrors) Error() string {
	return strings.Join(ve.Errors, "\n")
}

func (ve *ValidationErrors) addf(format string, args ...any) {
	ve.Errors = append(ve.Errors, fmt.Sprintf(format, args...))
}

func (ve *ValidationErrors) hasErrors() bool {
	return len(ve.Errors) > 0
}

var (
	appNameRe = regexp.MustCompile(`^[a-z0-9-]+$`)
	domainRe  = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$`)
)

// Validate checks the entire config and returns all errors found.
func Validate(cfg *Config) error {
	ve := &ValidationErrors{}

	// Poll interval must be a valid Go duration.
	if cfg.PollInterval != "" {
		if _, err := time.ParseDuration(cfg.PollInterval); err != nil {
			ve.addf("poll_interval: invalid duration %q", cfg.PollInterval)
		}
	}

	// Backup destinations.
	for name, dest := range cfg.BackupDests {
		prefix := fmt.Sprintf("backup_destination '%s'", name)
		if dest.Driver != "r2" && dest.Driver != "s3" {
			ve.addf("%s: driver must be 'r2' or 's3', got %q", prefix, dest.Driver)
		}
	}

	// Tunnel.
	if cfg.Tunnel != nil {
		if cfg.Tunnel.Provider != "cloudflare" && cfg.Tunnel.Provider != "tailscale" {
			ve.addf("tunnel: provider must be 'cloudflare' or 'tailscale', got %q", cfg.Tunnel.Provider)
		}
	}

	// Webhook port.
	if cfg.Webhook != nil && cfg.Webhook.Port != 0 {
		if cfg.Webhook.Port < 1 || cfg.Webhook.Port > 65535 {
			ve.addf("webhook: invalid port %d", cfg.Webhook.Port)
		}
	}

	// Notification channels.
	for name, ch := range cfg.Notifications {
		if !ValidNotifyDrivers[ch.Driver] {
			ve.addf("notification '%s': driver must be telegram, slack, discord, or webhook, got %q", name, ch.Driver)
		}
	}

	// Apps.
	for name, app := range cfg.Apps {
		validateApp(ve, name, &app, cfg.BackupDests, cfg.Notifications)
	}

	if ve.hasErrors() {
		return ve
	}
	return nil
}

func validateApp(ve *ValidationErrors, name string, app *App, backupDests map[string]BackupDestination, notifications map[string]NotificationChannel) {
	prefix := fmt.Sprintf("app '%s'", name)

	// App name format.
	if !appNameRe.MatchString(name) {
		ve.addf("%s: name must match [a-z0-9-]+", prefix)
	}

	// Required: repo.
	if app.Repo == "" {
		ve.addf("%s: repo is required", prefix)
	}

	// Required: at least one domain.
	if len(app.Domains) == 0 {
		ve.addf("%s: at least one domain is required", prefix)
	}

	// Strategy.
	if app.Strategy != "restart" && app.Strategy != "blue-green" {
		ve.addf("%s: strategy must be 'restart' or 'blue-green', got %q", prefix, app.Strategy)
	}

	// Domains.
	for i, d := range app.Domains {
		dprefix := fmt.Sprintf("%s: domain '%s'", prefix, d.Host)
		if d.Host == "" {
			ve.addf("%s: domain[%d]: host is required", prefix, i)
		} else if !domainRe.MatchString(d.Host) {
			ve.addf("%s: invalid hostname", dprefix)
		}
		if d.Port < 1 || d.Port > 65535 {
			ve.addf("%s: invalid port %d", dprefix, d.Port)
		}
	}

	// Health checks.
	for _, h := range app.Health {
		if !strings.HasPrefix(h.Path, "/") {
			ve.addf("%s: health check path must start with '/', got %q", prefix, h.Path)
		}
		if h.Port < 1 || h.Port > 65535 {
			ve.addf("%s: health check invalid port %d", prefix, h.Port)
		}
	}

	// Warmup duration.
	if app.Warmup != "" {
		if _, err := time.ParseDuration(app.Warmup); err != nil {
			ve.addf("%s: warmup: invalid duration %q", prefix, app.Warmup)
		}
	}

	// Backup.
	if app.Backup != nil {
		if app.Backup.Destination == "" {
			ve.addf("%s: backup: destination is required", prefix)
		} else if _, ok := backupDests[app.Backup.Destination]; !ok {
			ve.addf("%s: backup: destination %q not defined in backup_destinations", prefix, app.Backup.Destination)
		}
		if app.Backup.Schedule != "" {
			validateCronSchedule(ve, fmt.Sprintf("%s: backup schedule", prefix), app.Backup.Schedule)
		}
	}

	// Cron tasks.
	for i, task := range app.Cron {
		taskPrefix := fmt.Sprintf("%s: cron[%d]", prefix, i)
		validateCronSchedule(ve, taskPrefix+" schedule", task.Schedule)
		if task.Service == "" {
			ve.addf("%s: service is required", taskPrefix)
		}
		if task.Command == "" {
			ve.addf("%s: command is required", taskPrefix)
		}
	}

	// Notify: each referenced channel must exist in notifications.
	for _, ch := range app.Notify {
		if _, ok := notifications[ch]; !ok {
			ve.addf("%s: notify references undefined channel %q", prefix, ch)
		}
	}
}

// validateCronSchedule checks that a cron expression has exactly 5 fields.
func validateCronSchedule(ve *ValidationErrors, prefix, schedule string) {
	fields := strings.Fields(schedule)
	if len(fields) != 5 {
		ve.addf("%s: must have 5 fields, got %d", prefix, len(fields))
	}
}
