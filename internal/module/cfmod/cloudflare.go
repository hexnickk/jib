// Package cfmod provides the Cloudflare tunnel module for jib.
// It contributes the cloudflared container to the stack, and manages
// tunnel route creation/removal during app add/remove.
package cfmod

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/hexnickk/jib/internal/cloudflare"
	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/module"
)

// Module implements ComposeProvider and SetupHook for Cloudflare tunnels.
type Module struct{}

var (
	_ module.ComposeProvider = (*Module)(nil)
	_ module.SetupHook       = (*Module)(nil)
)

func (m *Module) Name() string { return "cloudflare" }

func (m *Module) ComposeServices(cfg *config.Config, tokens map[string]string) string {
	if cfg.Tunnel == nil || cfg.Tunnel.Provider != "cloudflare" {
		return ""
	}

	return fmt.Sprintf(`
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    network_mode: host
    entrypoint: ["/bin/sh", "-c", "exec cloudflared tunnel --no-autoupdate run --token $(cat /run/secrets/tunnel-token)"]
    volumes:
      - %s:/run/secrets/tunnel-token:ro
`, config.CredsPath("cloudflare", "tunnel-token"))
}

func (m *Module) OnAppAdd(ctx context.Context, app string, appCfg config.App, cfg *config.Config) error {
	domains := tunnelDomains(appCfg)
	if len(domains) == 0 {
		return nil
	}

	fmt.Println("Setting up Cloudflare tunnel routes...")
	if err := m.addRoutes(ctx, cfg, domains); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: %v\n", err)
		fmt.Fprintln(os.Stderr, "  You may need to add DNS records and tunnel routes manually.")
		return nil // non-fatal
	}
	return nil
}

func (m *Module) OnAppRemove(ctx context.Context, app string, appCfg config.App, cfg *config.Config) error {
	domains := tunnelDomains(appCfg)
	if len(domains) == 0 {
		return nil
	}

	return m.removeRoutes(ctx, cfg, domains)
}

func (m *Module) addRoutes(ctx context.Context, cfg *config.Config, domains []string) error {
	token, err := loadAPIToken()
	if err != nil {
		return err
	}
	tunnelID, accountID, err := tunnelConfig(cfg)
	if err != nil {
		return err
	}

	client := cloudflare.NewClient(token)
	return client.AddTunnelRoutes(ctx, accountID, tunnelID, domains)
}

func (m *Module) removeRoutes(ctx context.Context, cfg *config.Config, domains []string) error {
	token, err := loadAPIToken()
	if err != nil {
		return err
	}
	tunnelID, accountID, err := tunnelConfig(cfg)
	if err != nil {
		return err
	}

	client := cloudflare.NewClient(token)
	return client.RemoveTunnelRoutes(ctx, accountID, tunnelID, domains)
}

func loadAPIToken() (string, error) {
	path := config.CredsPath("cloudflare", "api-token")
	data, err := os.ReadFile(path) //nolint:gosec // path from trusted root
	if err != nil {
		return "", fmt.Errorf("cloudflare API token not found — run 'jib cloudflare setup' with API mode first")
	}
	return strings.TrimSpace(string(data)), nil
}

func tunnelConfig(cfg *config.Config) (tunnelID, accountID string, err error) {
	if cfg.Tunnel == nil || cfg.Tunnel.TunnelID == "" {
		return "", "", fmt.Errorf("no tunnel configured — run 'jib cloudflare setup' first")
	}
	return cfg.Tunnel.TunnelID, cfg.Tunnel.AccountID, nil
}

func tunnelDomains(appCfg config.App) []string {
	var domains []string
	for _, d := range appCfg.Domains {
		if d.Ingress == "cloudflare-tunnel" {
			domains = append(domains, d.Host)
		}
	}
	return domains
}
