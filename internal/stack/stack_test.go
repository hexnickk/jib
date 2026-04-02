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
	compose := GenerateCompose(cfg, tokens, nil)

	if !strings.Contains(compose, "jib-bus:") {
		t.Error("jib-bus service missing")
	}
	if !strings.Contains(compose, "nats:alpine") {
		t.Error("NATS image missing")
	}
	// No module services provided
	if strings.Contains(compose, "jib-health") {
		t.Error("health should not be included without module services")
	}
	if strings.Contains(compose, "jib-notifications-") {
		t.Error("notifiers should not be included without module services")
	}
}

func TestGenerateCompose_WithModuleServices(t *testing.T) {
	cfg := &config.Config{
		ConfigVersion: 2,
		PollInterval:  "5m",
		Apps: map[string]config.App{
			"myapp": {Repo: "org/repo", Strategy: "restart", Branch: "main",
				Domains: []config.Domain{{Host: "example.com", Port: 80}}},
		},
	}
	tokens := &Tokens{Daemon: "d", Trigger: "t", Monitor: "m", Notifier: "n"}

	moduleServices := []string{
		"\n  jib-health:\n    image: test-health\n",
		"\n  cloudflared:\n    image: cloudflare/cloudflared\n",
	}
	compose := GenerateCompose(cfg, tokens, moduleServices)

	for _, want := range []string{"jib-bus:", "jib-health:", "cloudflared:"} {
		if !strings.Contains(compose, want) {
			t.Errorf("missing %q in compose", want)
		}
	}
}

func TestTokenMap(t *testing.T) {
	tokens := &Tokens{Daemon: "d", Trigger: "t", Monitor: "m", Notifier: "n"}
	m := tokens.TokenMap()

	if m["daemon"] != "d" || m["trigger"] != "t" || m["monitor"] != "m" || m["notifier"] != "n" {
		t.Errorf("unexpected token map: %v", m)
	}
}
