package proxy

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/hexnickk/jib/internal/config"
)

// sudoCommand creates an exec.Cmd that prepends "sudo" when not running as root.
func sudoCommand(name string, args ...string) *exec.Cmd {
	if os.Getuid() == 0 {
		return exec.Command(name, args...) //nolint:gosec // name is a trusted command like "nginx"
	}
	return exec.Command("sudo", append([]string{name}, args...)...) //nolint:gosec // args are trusted internal values
}

// Nginx implements the Proxy interface using nginx.
type Nginx struct {
	ConfigDir  string // e.g. /opt/jib/nginx/
	SymlinkDir string // e.g. /etc/nginx/conf.d/
}

// NewNginx creates an Nginx proxy manager.
// configDir is where jib writes conf files (e.g. /opt/jib/nginx/).
// symlinkDir is the platform's nginx include directory (e.g. /etc/nginx/conf.d/).
func NewNginx(configDir, symlinkDir string) *Nginx {
	return &Nginx{
		ConfigDir:  configDir,
		SymlinkDir: symlinkDir,
	}
}

// templateData holds the values interpolated into the nginx config template.
type templateData struct {
	Filename string
	Domain   string
	Port     int
	HasSSL   bool
	IsTunnel bool // true for cloudflare-tunnel — skips ACME challenge
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
		isTunnel := d.IsTunnelIngress()

		hasSSL := false
		if !isTunnel {
			certPath := fmt.Sprintf("/etc/letsencrypt/live/%s/fullchain.pem", d.Host)
			_, certErr := os.Stat(certPath)
			hasSSL = certErr == nil
		}

		data := templateData{
			Filename: filename,
			Domain:   d.Host,
			Port:     d.Port,
			HasSSL:   hasSSL,
			IsTunnel: isTunnel,
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
	if err := os.MkdirAll(n.ConfigDir, 0o755); err != nil { //nolint:gosec // nginx config dir needs to be world-readable
		return fmt.Errorf("creating config dir %s: %w", n.ConfigDir, err)
	}

	for filename, content := range configs {
		confPath := filepath.Join(n.ConfigDir, filename)
		if err := os.WriteFile(confPath, []byte(content), 0o644); err != nil { //nolint:gosec // nginx config must be world-readable
			return fmt.Errorf("writing %s: %w", confPath, err)
		}

		linkPath := filepath.Join(n.SymlinkDir, filename)
		_ = os.Remove(linkPath)
		if err := os.Symlink(confPath, linkPath); err != nil {
			// Fall back to sudo for system dirs like /etc/nginx/conf.d/
			cmd := sudoCommand("ln", "-sf", confPath, linkPath)
			if out, err := cmd.CombinedOutput(); err != nil {
				return fmt.Errorf("symlinking %s → %s: %w: %s", linkPath, confPath, err, out)
			}
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
			// Fall back to sudo for system dirs
			if out, err := sudoCommand("rm", "-f", linkPath).CombinedOutput(); err != nil {
				if firstErr == nil {
					firstErr = fmt.Errorf("removing symlink %s: %w: %s", linkPath, err, out)
				}
			}
		}
	}

	return firstErr
}

// Reload signals nginx to reload its configuration.
func (n *Nginx) Reload() error {
	cmd := sudoCommand("nginx", "-s", "reload")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("nginx reload failed: %s: %w", string(out), err)
	}
	return nil
}

// Test validates the nginx configuration.
func (n *Nginx) Test() error {
	cmd := sudoCommand("nginx", "-t")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("nginx config test failed: %s: %w", string(out), err)
	}
	return nil
}
