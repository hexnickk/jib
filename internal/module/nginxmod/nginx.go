// Package nginxmod provides the nginx reverse-proxy module for jib.
// It manages nginx config generation and reload during app add/remove.
package nginxmod

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/module"
	"github.com/hexnickk/jib/internal/proxy"
)

// Module implements module.SetupHook for nginx proxy management.
type Module struct {
	Root string // jib root directory (e.g. /opt/jib)
}

var _ module.SetupHook = (*Module)(nil)

func (m *Module) Name() string { return "nginx" }

func (m *Module) newProxy() *proxy.Nginx {
	return proxy.NewNginx(
		filepath.Join(m.Root, "nginx"),
		"/etc/nginx/conf.d",
	)
}

func (m *Module) OnAppAdd(ctx context.Context, app string, appCfg config.App, cfg *config.Config) error {
	if len(appCfg.Domains) == 0 {
		return nil
	}

	fmt.Println("Provisioning nginx...")
	p := m.newProxy()

	configs, err := p.GenerateConfig(app, appCfg)
	if err != nil {
		return fmt.Errorf("generating nginx config: %w", err)
	}
	if err := p.WriteConfigs(configs); err != nil {
		return fmt.Errorf("writing nginx configs: %w", err)
	}
	for filename := range configs {
		fmt.Printf("  nginx: %s\n", filename)
	}

	if err := p.Test(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: nginx config test failed: %v\n", err)
		return nil
	}
	if err := p.Reload(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: nginx reload failed: %v\n", err)
		return nil
	}
	fmt.Println("  nginx: reloaded")
	return nil
}

func (m *Module) OnAppRemove(ctx context.Context, app string, appCfg config.App, cfg *config.Config) error {
	if len(appCfg.Domains) == 0 {
		return nil
	}

	p := m.newProxy()
	if err := p.RemoveConfigs(app, appCfg.Domains); err != nil {
		return fmt.Errorf("removing nginx configs: %w", err)
	}

	if err := p.Test(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: nginx config test failed: %v\n", err)
		return nil
	}
	if err := p.Reload(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: nginx reload failed: %v\n", err)
		return nil
	}
	return nil
}
