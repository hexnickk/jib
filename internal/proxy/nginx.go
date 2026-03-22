package proxy

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

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

		data := templateData{
			Filename:     filename,
			Domain:       d.Host,
			Port:         d.Port,
			WebhookPort:  n.WebhookPort,
			NginxInclude: appCfg.NginxInclude,
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
