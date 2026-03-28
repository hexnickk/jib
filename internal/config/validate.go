package config

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// ValidationError collects multiple validation problems.
type ValidationError struct {
	Errors []string
}

func (ve *ValidationError) Error() string {
	return strings.Join(ve.Errors, "\n")
}

func (ve *ValidationError) addf(format string, args ...any) {
	ve.Errors = append(ve.Errors, fmt.Sprintf(format, args...))
}

func (ve *ValidationError) hasErrors() bool {
	return len(ve.Errors) > 0
}

var (
	appNameRe = regexp.MustCompile(`^[a-z0-9-]+$`)
	domainRe  = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$`)
)

// Validate checks the entire config and returns all errors found.
func Validate(cfg *Config) error {
	ve := &ValidationError{}

	// Poll interval must be a valid Go duration.
	if cfg.PollInterval != "" {
		if _, err := time.ParseDuration(cfg.PollInterval); err != nil {
			ve.addf("poll_interval: invalid duration %q", cfg.PollInterval)
		}
	}

	// Backup destinations.
	validBackupDrivers := map[string]bool{"r2": true, "s3": true, "ssh": true, "local": true}
	for name, dest := range cfg.BackupDests {
		prefix := fmt.Sprintf("backup_destination '%s'", name)
		if !validBackupDrivers[dest.Driver] {
			ve.addf("%s: driver must be r2, s3, ssh, or local, got %q", prefix, dest.Driver)
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

	// GitHub providers.
	if cfg.GitHub != nil {
		for name, p := range cfg.GitHub.Providers {
			prefix := fmt.Sprintf("github.providers '%s'", name)
			if !appNameRe.MatchString(name) {
				ve.addf("%s: name must match [a-z0-9-]+", prefix)
			}
			if p.Type != "key" && p.Type != "app" {
				ve.addf("%s: type must be 'key' or 'app', got %q", prefix, p.Type)
			}
			if p.Type == "app" && p.AppID <= 0 {
				ve.addf("%s: app_id is required for type 'app'", prefix)
			}
		}
	}

	// Apps.
	for name, app := range cfg.Apps {
		validateApp(ve, name, &app, cfg.GitHub, cfg.BackupDests, cfg.Notifications)
	}

	if ve.hasErrors() {
		return ve
	}
	return nil
}

func validateApp(ve *ValidationError, name string, app *App, github *GitHubConfig, backupDests map[string]BackupDestination, notifications map[string]NotificationChannel) {
	prefix := fmt.Sprintf("app '%s'", name)

	// App name format.
	if !appNameRe.MatchString(name) {
		ve.addf("%s: name must match [a-z0-9-]+", prefix)
	}

	// Required: repo.
	if app.Repo == "" {
		ve.addf("%s: repo is required", prefix)
	}

	// Provider must reference an existing github provider (if set).
	if app.Provider != "" && app.Repo != "local" {
		found := false
		if github != nil {
			if _, ok := github.Providers[app.Provider]; ok {
				found = true
			}
		}
		if !found {
			ve.addf("%s: provider %q not found in github.providers", prefix, app.Provider)
		}
	}

	// App-level ingress (deprecated, kept for backward compat).
	if app.Ingress != "" && !ValidIngressValues[app.Ingress] {
		ve.addf("%s: ingress must be 'direct', 'cloudflare-tunnel', or 'tailscale', got %q", prefix, app.Ingress)
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
		if d.Ingress != "" && !ValidIngressValues[d.Ingress] {
			ve.addf("%s: ingress must be 'direct', 'cloudflare-tunnel', or 'tailscale', got %q", dprefix, d.Ingress)
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
		dests := app.Backup.EffectiveDestinations()
		if len(dests) == 0 {
			ve.addf("%s: backup: at least one destination is required", prefix)
		}
		for _, d := range dests {
			if _, ok := backupDests[d]; !ok {
				ve.addf("%s: backup: destination %q not defined in backup_destinations", prefix, d)
			}
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
func validateCronSchedule(ve *ValidationError, prefix, schedule string) {
	fields := strings.Fields(schedule)
	if len(fields) != 5 {
		ve.addf("%s: must have 5 fields, got %d", prefix, len(fields))
	}
}
