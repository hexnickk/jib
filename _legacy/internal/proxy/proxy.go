package proxy

import "github.com/hexnickk/jib/internal/config"

// Proxy abstracts reverse-proxy configuration management.
// Only nginx is implemented today; Caddy or others can be added later.
type Proxy interface {
	// GenerateConfig produces per-domain nginx conf files for an app.
	// Returns a map of filename to file content.
	GenerateConfig(app string, appCfg config.App) (map[string]string, error)

	// WriteConfigs writes config files to the config directory and creates
	// symlinks in the platform's nginx config directory.
	WriteConfigs(configs map[string]string) error

	// RemoveConfigs removes config files and symlinks for the given domains.
	RemoveConfigs(app string, domains []config.Domain) error

	// Reload signals the proxy to reload its configuration.
	Reload() error

	// Test validates the current proxy configuration.
	Test() error
}
