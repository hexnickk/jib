// Package cfmod provides the Cloudflare tunnel SetupHook for jib.
// It manages tunnel route creation/removal during app add/remove.
// The cloudflared container itself is managed by the separate jib-cloudflared
// binary and its systemd unit, installed by `jib cloudflare setup`.
package cfmod

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/hexnickk/jib/internal/cfapi"
	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/module"
)

// Module implements SetupHook for Cloudflare tunnel route management.
type Module struct{}

var _ module.SetupHook = (*Module)(nil)

func (m *Module) Name() string { return "cloudflare" }

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

	client := cfapi.NewClient(token)
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

	client := cfapi.NewClient(token)
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
