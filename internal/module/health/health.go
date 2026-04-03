// Package health provides the health-check module for jib.
// It contributes a health monitor container to the jib stack when any
// app has health checks configured.
package health

import (
	"fmt"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/module"
)

// Module implements module.ComposeProvider for health monitoring.
type Module struct{}

var _ module.ComposeProvider = (*Module)(nil)

func (m *Module) Name() string { return "health" }

func (m *Module) ComposeServices(cfg *config.Config, tokens map[string]string) string {
	hasHealth := false
	for _, app := range cfg.Apps {
		if len(app.Health) > 0 {
			hasHealth = true
			break
		}
	}
	if !hasHealth {
		return ""
	}

	return fmt.Sprintf(`
  jib-health:
    build:
      context: %s
      dockerfile: cmd/jib-health/Dockerfile
    restart: unless-stopped
    network_mode: host
    environment:
      JIB_CONFIG: %s
      JIB_SECRETS: %s
      NATS_URL: nats://localhost:4222
      NATS_USER: %s
      NATS_PASS: %s
    volumes:
      - %s:%s:ro
      - %s:%s:ro
`, config.RepoRoot(), config.ConfigFile(), config.SecretsDir(),
		"monitor", tokens["monitor"],
		config.ConfigFile(), config.ConfigFile(),
		config.SecretsDir(), config.SecretsDir())
}
