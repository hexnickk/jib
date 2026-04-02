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
type Module struct {
	RepoRoot string // path to jib source repo for building images
}

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
      dockerfile: services/jib-health/Dockerfile
    restart: unless-stopped
    network_mode: host
    environment:
      JIB_CONFIG: /opt/jib/config.yml
      JIB_SECRETS: /opt/jib/secrets
      NATS_URL: nats://localhost:4222
      NATS_USER: %s
      NATS_PASS: %s
    volumes:
      - /opt/jib/config.yml:/opt/jib/config.yml:ro
      - /opt/jib/secrets:/opt/jib/secrets:ro
`, m.RepoRoot, "monitor", tokens["monitor"])
}
