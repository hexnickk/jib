package stack

import (
	"strings"
	"testing"
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

func TestGenerateCompose(t *testing.T) {
	compose := GenerateCompose()

	if !strings.Contains(compose, "jib-bus:") {
		t.Error("jib-bus service missing")
	}
	if !strings.Contains(compose, "nats:alpine") {
		t.Error("NATS image missing")
	}
	if !strings.Contains(compose, "127.0.0.1:4222:4222") {
		t.Error("NATS port binding missing")
	}
	if !strings.Contains(compose, NetworkName) {
		t.Error("network name missing")
	}
	if !strings.Contains(compose, ProjectName) {
		t.Error("project name missing")
	}
	if !strings.Contains(compose, "nats.conf") {
		t.Error("NATS config mount missing")
	}
}
