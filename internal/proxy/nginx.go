package proxy

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/hexnickk/jib/internal/config"
)

// Nginx implements the Proxy interface using nginx.
type Nginx struct {
	ConfigDir   string // e.g. /opt/jib/nginx/
	SymlinkDir  string // e.g. /etc/nginx/conf.d/
	WebhookPort int    // 0 means no webhook location
}

// NewNginx creates an Nginx proxy manager.
// configDir is where jib writes conf files (e.g. /opt/jib/nginx/).
// symlinkDir is the platform's nginx include directory (e.g. /etc/nginx/conf.d/).
// webhookPort is the port jib's webhook listener runs on; 0 disables the location block.
func NewNginx(configDir, symlinkDir string, webhookPort int) *Nginx {
	return &Nginx{
		ConfigDir:   configDir,
		SymlinkDir:  symlinkDir,
		WebhookPort: webhookPort,
	}
}

// templateData holds the values interpolated into the nginx config template.
type templateData struct {
	Filename     string
	Domain       string
	Port         int
	WebhookPort  int
	NginxInclude string
	HasSSL       bool
}

// confFilename returns the config filename for a domain.
func confFilename(domain string) string {
	return domain + ".conf"
}

// GenerateConfig produces per-domain nginx conf files for an app.
func (n *Nginx) GenerateConfig(app string, appCfg config.App) (map[string]string, error) {
	configs := make(map[string]string, len(appCfg.Domains))

	for _, d := range appCfg.Domains {
		if d.Host == "" {
			return nil, fmt.Errorf("app %s: domain has empty host", app)
		}
		if d.Port <= 0 {
			return nil, fmt.Errorf("app %s: domain %s has invalid port %d", app, d.Host, d.Port)
		}

		filename := confFilename(d.Host)

		certPath := fmt.Sprintf("/etc/letsencrypt/live/%s/fullchain.pem", d.Host)
		_, certErr := os.Stat(certPath)
		hasSSL := certErr == nil

		data := templateData{
			Filename:     filename,
			Domain:       d.Host,
			Port:         d.Port,
			WebhookPort:  n.WebhookPort,
			NginxInclude: appCfg.NginxInclude,
			HasSSL:       hasSSL,
		}

		var buf bytes.Buffer
		if err := nginxTmpl.Execute(&buf, data); err != nil {
			return nil, fmt.Errorf("app %s: template error for domain %s: %w", app, d.Host, err)
		}

		configs[filename] = buf.String()
	}

	return configs, nil
}

// WriteConfigs writes config files to ConfigDir and creates symlinks in SymlinkDir.
func (n *Nginx) WriteConfigs(configs map[string]string) error {
	if err := os.MkdirAll(n.ConfigDir, 0o755); err != nil {
		return fmt.Errorf("creating config dir %s: %w", n.ConfigDir, err)
	}
	if err := os.MkdirAll(n.SymlinkDir, 0o755); err != nil {
		return fmt.Errorf("creating symlink dir %s: %w", n.SymlinkDir, err)
	}

	for filename, content := range configs {
		confPath := filepath.Join(n.ConfigDir, filename)
		if err := os.WriteFile(confPath, []byte(content), 0o644); err != nil {
			return fmt.Errorf("writing %s: %w", confPath, err)
		}

		linkPath := filepath.Join(n.SymlinkDir, filename)
		// Remove existing symlink/file before creating a new one.
		_ = os.Remove(linkPath)
		if err := os.Symlink(confPath, linkPath); err != nil {
			return fmt.Errorf("symlinking %s → %s: %w", linkPath, confPath, err)
		}
	}

	return nil
}

// RemoveConfigs removes config files and symlinks for the given domains.
func (n *Nginx) RemoveConfigs(app string, domains []config.Domain) error {
	var firstErr error
	for _, d := range domains {
		filename := confFilename(d.Host)

		confPath := filepath.Join(n.ConfigDir, filename)
		if err := os.Remove(confPath); err != nil && !os.IsNotExist(err) {
			if firstErr == nil {
				firstErr = fmt.Errorf("removing %s: %w", confPath, err)
			}
		}

		linkPath := filepath.Join(n.SymlinkDir, filename)
		if err := os.Remove(linkPath); err != nil && !os.IsNotExist(err) {
			if firstErr == nil {
				firstErr = fmt.Errorf("removing symlink %s: %w", linkPath, err)
			}
		}
	}

	return firstErr
}

// Reload signals nginx to reload its configuration.
func (n *Nginx) Reload() error {
	cmd := exec.Command("nginx", "-s", "reload")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("nginx reload failed: %s: %w", string(out), err)
	}
	return nil
}

// Test validates the nginx configuration.
func (n *Nginx) Test() error {
	cmd := exec.Command("nginx", "-t")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("nginx config test failed: %s: %w", string(out), err)
	}
	return nil
}

// MaintenanceOn enables maintenance mode for an app by backing up each domain's
// nginx config and replacing it with a 503 maintenance page.
func (n *Nginx) MaintenanceOn(app string, domains []config.Domain, message string) error {
	if message == "" {
		message = "Service is temporarily unavailable. We'll be back shortly."
	}

	// Write the maintenance HTML page
	htmlDir := filepath.Join(n.ConfigDir, "maintenance")
	if err := os.MkdirAll(htmlDir, 0o755); err != nil {
		return fmt.Errorf("creating maintenance html dir: %w", err)
	}

	htmlContent := strings.ReplaceAll(maintenanceHTMLTemplate, "{{MESSAGE}}", message)
	htmlPath := filepath.Join(htmlDir, "maintenance.html")
	if err := os.WriteFile(htmlPath, []byte(htmlContent), 0o644); err != nil {
		return fmt.Errorf("writing maintenance html: %w", err)
	}

	// Track which domains we've successfully switched so we can roll back on failure.
	var switched []config.Domain

	rollback := func() {
		for _, rd := range switched {
			fn := confFilename(rd.Host)
			cp := filepath.Join(n.ConfigDir, fn)
			bp := cp + ".bak"
			_ = os.Rename(bp, cp)
		}
	}

	for _, d := range domains {
		filename := confFilename(d.Host)
		confPath := filepath.Join(n.ConfigDir, filename)
		bakPath := confPath + ".bak"

		// Check if already in maintenance
		if _, err := os.Stat(bakPath); err == nil {
			rollback()
			return fmt.Errorf("app %s domain %s is already in maintenance mode", app, d.Host)
		}

		// Back up the existing config
		if err := os.Rename(confPath, bakPath); err != nil {
			rollback()
			return fmt.Errorf("backing up %s: %w", confPath, err)
		}

		// Check if SSL cert exists for this domain
		certPath := fmt.Sprintf("/etc/letsencrypt/live/%s/fullchain.pem", d.Host)
		_, certErr := os.Stat(certPath)
		hasSSL := certErr == nil

		// Generate maintenance config
		data := maintenanceData{
			Domain:  d.Host,
			HTMLDir: htmlDir,
			HasSSL:  hasSSL,
		}

		var buf bytes.Buffer
		if err := maintenanceTmpl.Execute(&buf, data); err != nil {
			_ = os.Rename(bakPath, confPath)
			rollback()
			return fmt.Errorf("generating maintenance config for %s: %w", d.Host, err)
		}

		if err := os.WriteFile(confPath, buf.Bytes(), 0o644); err != nil {
			_ = os.Rename(bakPath, confPath)
			rollback()
			return fmt.Errorf("writing maintenance config for %s: %w", d.Host, err)
		}

		switched = append(switched, d)
	}

	return n.Reload()
}

// MaintenanceOff disables maintenance mode by restoring backed-up configs.
func (n *Nginx) MaintenanceOff(app string, domains []config.Domain) error {
	for _, d := range domains {
		filename := confFilename(d.Host)
		confPath := filepath.Join(n.ConfigDir, filename)
		bakPath := confPath + ".bak"

		if _, err := os.Stat(bakPath); os.IsNotExist(err) {
			return fmt.Errorf("app %s domain %s is not in maintenance mode (no .bak file)", app, d.Host)
		}

		// Restore from backup
		if err := os.Rename(bakPath, confPath); err != nil {
			return fmt.Errorf("restoring %s from backup: %w", confPath, err)
		}
	}

	return n.Reload()
}

// MaintenanceStatus returns a map of app name to list of domains in maintenance mode.
// It scans the config directory for .conf.bak files and matches them to app domains.
func (n *Nginx) MaintenanceStatus(apps map[string]config.App) map[string][]string {
	result := make(map[string][]string)

	for appName, appCfg := range apps {
		for _, d := range appCfg.Domains {
			filename := confFilename(d.Host)
			bakPath := filepath.Join(n.ConfigDir, filename+".bak")
			if _, err := os.Stat(bakPath); err == nil {
				result[appName] = append(result[appName], d.Host)
			}
		}
	}

	return result
}

// IsInMaintenance returns true if any domain for the app has a .bak file.
func (n *Nginx) IsInMaintenance(app string, domains []config.Domain) bool {
	for _, d := range domains {
		filename := confFilename(d.Host)
		bakPath := filepath.Join(n.ConfigDir, filename+".bak")
		if _, err := os.Stat(bakPath); err == nil {
			return true
		}
	}
	return false
}
