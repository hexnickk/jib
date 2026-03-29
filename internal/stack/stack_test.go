package stack

import (
	"strings"
	"testing"

	"github.com/hexnickk/jib/internal/config"
)

func TestGenerateTokens(t *testing.T) {
	tokens, err := GenerateTokens()
	if err != nil {
		t.Fatal(err)
	}
	if tokens.Daemon == "" || tokens.Trigger == "" || tokens.Monitor == "" || tokens.Notifier == "" {
		t.Error("all tokens should be non-empty")
	}
	if tokens.Daemon == tokens.Trigger {
		t.Error("tokens should be unique")
	}
	if len(tokens.Daemon) != 32 { // 16 bytes = 32 hex chars
		t.Errorf("token length = %d, want 32", len(tokens.Daemon))
	}
}

func TestGenerateNATSConf(t *testing.T) {
	tokens := &Tokens{Daemon: "d", Trigger: "t", Monitor: "m", Notifier: "n"}
	conf := GenerateNATSConf(tokens)

	if !strings.Contains(conf, `password: "d"`) {
		t.Error("daemon token not found in config")
	}
	if !strings.Contains(conf, `password: "t"`) {
		t.Error("trigger token not found in config")
	}
	if !strings.Contains(conf, "authorization") {
		t.Error("authorization block missing")
	}
}

func TestGenerateCompose_MinimalConfig(t *testing.T) {
	cfg := &config.Config{
		ConfigVersion: 2,
		PollInterval:  "5m",
		Apps: map[string]config.App{
			"myapp": {Repo: "org/repo", Strategy: "restart", Branch: "main",
				Domains: []config.Domain{{Host: "example.com", Port: 80}}},
		},
	}
	tokens := &Tokens{Daemon: "d", Trigger: "t", Monitor: "m", Notifier: "n"}
	compose := GenerateCompose(cfg, tokens)

	if !strings.Contains(compose, "jib-bus:") {
		t.Error("jib-bus service missing")
	}
	if !strings.Contains(compose, "nats:alpine") {
		t.Error("NATS image missing")
	}
	// Minimal config: no webhook, no health, no notifiers
	if strings.Contains(compose, "jib-webhook") {
		t.Error("webhook should not be included without config")
	}
	if strings.Contains(compose, "jib-health") {
		t.Error("health should not be included without health checks")
	}
	if strings.Contains(compose, "jib-notifications") {
		t.Error("notifiers should not be included without notifications config")
	}
}

func TestGenerateCompose_FullConfig(t *testing.T) {
	cfg := &config.Config{
		ConfigVersion: 2,
		PollInterval:  "5m",
		CertbotEmail:  "test@example.com",
		Webhook:       &config.WebhookConfig{Enabled: true, Port: 9090},
		Notifications: map[string]config.NotificationChannel{
			"ops-tg":    {Driver: "telegram"},
			"dev-slack": {Driver: "slack"},
		},
		Tunnel: &config.TunnelConfig{Provider: "cloudflare", TunnelID: "abc123"},
		Apps: map[string]config.App{
			"myapp": {Repo: "org/repo", Strategy: "restart", Branch: "main",
				Domains: []config.Domain{{Host: "example.com", Port: 80}},
				Health:  []config.HealthCheck{{Path: "/health", Port: 80}}},
		},
	}
	tokens := &Tokens{Daemon: "d", Trigger: "t", Monitor: "m", Notifier: "n"}
	compose := GenerateCompose(cfg, tokens)

	for _, want := range []string{
		"jib-bus:", "jib-webhook:", "jib-health:", "jib-certs:",
		"jib-notifications-telegram:", "jib-notifications-slack:",
		"cloudflared:", "cloudflare/cloudflared",
	} {
		if !strings.Contains(compose, want) {
			t.Errorf("missing %q in compose", want)
		}
	}

	// Discord should NOT be present (not in config)
	if strings.Contains(compose, "jib-notifications-discord") {
		t.Error("discord notifier should not be present")
	}

	// Tailscale should NOT be present
	if strings.Contains(compose, "tailscale") {
		t.Error("tailscale should not be present with cloudflare tunnel")
	}
}
