// Package notifier provides the notification compose module for jib.
// It contributes a single jib-notifier container to the stack that handles
// all configured notification channels.
package notifier

import (
	"fmt"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/module"
	"github.com/hexnickk/jib/internal/stack"
)

// Module implements module.ComposeProvider for notifications.
type Module struct{}

var _ module.ComposeProvider = (*Module)(nil)

func (m *Module) Name() string { return "notifier" }

func (m *Module) ComposeServices(cfg *config.Config, tokens map[string]string) string {
	if len(cfg.Notifications) == 0 {
		return ""
	}

	return fmt.Sprintf(`
  jib-notifier:
    build:
      context: %s
      dockerfile: cmd/jib-notifier/Dockerfile
    restart: unless-stopped
    environment:
      JIB_CONFIG: %s
      JIB_SECRETS: %s
      NATS_URL: nats://jib-bus:4222
      NATS_USER: %s
      NATS_PASS: %s
    volumes:
      - %s:%s:ro
      - %s:%s:ro
    networks:
      - %s
`, config.RepoRoot(),
		config.ConfigFile(), config.SecretsDir(),
		"notifier", tokens["notifier"],
		config.ConfigFile(), config.ConfigFile(),
		config.SecretsDir(), config.SecretsDir(),
		stack.NetworkName)
}
