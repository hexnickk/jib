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

	// MaintenanceOn enables maintenance mode for an app's domains.
	MaintenanceOn(app string, domains []config.Domain, message string) error

	// MaintenanceOff disables maintenance mode, restoring original configs.
	MaintenanceOff(app string, domains []config.Domain) error

	// MaintenanceStatus returns a map of app name to domains in maintenance.
	MaintenanceStatus(apps map[string]config.App) map[string][]string

	// IsInMaintenance returns true if any domain for the app is in maintenance.
	IsInMaintenance(app string, domains []config.Domain) bool
}
