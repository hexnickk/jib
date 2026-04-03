// Package telegram provides the Telegram notification module for jib.
// It contributes per-channel notification containers to the jib stack.
package telegram

import (
	"fmt"
	"strings"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/module"
	"github.com/hexnickk/jib/internal/stack"
)

// Module implements module.ComposeProvider for Telegram notifications.
type Module struct {
	RepoRoot string
}

var _ module.ComposeProvider = (*Module)(nil)

func (m *Module) Name() string { return "telegram" }

func (m *Module) ComposeServices(cfg *config.Config, tokens map[string]string) string {
	if len(cfg.Notifications) == 0 {
		return ""
	}

	var b strings.Builder
	for name, ch := range cfg.Notifications {
		imageName := "jib-notifications-" + ch.Driver
		svcName := "jib-notifications-" + name
		fmt.Fprintf(&b, `
  %s:
    build:
      context: %s
      dockerfile: cmd/%s/Dockerfile
    restart: unless-stopped
    environment:
      JIB_CONFIG: /opt/jib/config.yml
      JIB_SECRETS: /opt/jib/secrets
      NATS_URL: nats://jib-bus:4222
      NATS_USER: %s
      NATS_PASS: %s
      CHANNEL_NAME: "%s"
      CREDS_FILE: "/opt/jib/secrets/_jib/%s.json"
    volumes:
      - /opt/jib/config.yml:/opt/jib/config.yml:ro
      - /opt/jib/secrets:/opt/jib/secrets:ro
    networks:
      - %s
`, svcName, m.RepoRoot, imageName, "notifier", tokens["notifier"], name, name, stack.NetworkName)
	}
	return b.String()
}
