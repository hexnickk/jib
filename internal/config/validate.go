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

	// Tunnel.
	if cfg.Tunnel != nil {
		if cfg.Tunnel.Provider != "cloudflare" {
			ve.addf("tunnel: provider must be 'cloudflare', got %q", cfg.Tunnel.Provider)
		}
	}

	// Notification channels.
	for name, ch := range cfg.Notifications {
		if !ValidNotifyDrivers[ch.Driver] {
			ve.addf("notification '%s': driver must be telegram, got %q", name, ch.Driver)
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
		validateApp(ve, name, &app, cfg.GitHub, cfg.Notifications)
	}

	if ve.hasErrors() {
		return ve
	}
	return nil
}

func validateApp(ve *ValidationError, name string, app *App, github *GitHubConfig, notifications map[string]NotificationChannel) {
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

	// Required: at least one domain.
	if len(app.Domains) == 0 {
		ve.addf("%s: at least one domain is required", prefix)
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
			ve.addf("%s: ingress must be 'direct' or 'cloudflare-tunnel', got %q", dprefix, d.Ingress)
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

	// Notify: each referenced channel must exist in notifications.
	for _, ch := range app.Notify {
		if _, ok := notifications[ch]; !ok {
			ve.addf("%s: notify references undefined channel %q", prefix, ch)
		}
	}
}
