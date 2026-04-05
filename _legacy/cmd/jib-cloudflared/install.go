package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"

	"github.com/hexnickk/jib/internal/config"
)

// unitPath is where the systemd unit file is written during install.
const unitPath = "/etc/systemd/system/" + serviceName + ".service"

// cloudflaredPaths returns the on-disk locations jib-cloudflared manages,
// rooted under config.CloudflaredDir() so JIB_ROOT is honored end-to-end.
// The tunnel token env file is NOT written here — it lives under
// config.CredsPath and is written by `jib cloudflare setup`.
func cloudflaredPaths() (dir, compose string) {
	dir = config.CloudflaredDir()
	return dir, filepath.Join(dir, "docker-compose.yml")
}

// render templates an embedded file with the runtime paths so both the unit
// and the compose file reference the same config.Root-derived locations.
// TunnelEnvPath must stay in sync with cmd/jib's tunnelTokenEnvPath — both
// point at the env file that carries TUNNEL_TOKEN into the container.
func render(name string, src []byte) ([]byte, error) {
	tmpl, err := template.New(name).Parse(string(src))
	if err != nil {
		return nil, fmt.Errorf("parsing %s template: %w", name, err)
	}
	var buf bytes.Buffer
	data := map[string]string{
		"CloudflaredDir": config.CloudflaredDir(),
		"TunnelEnvPath":  config.CredsPath("cloudflare", "tunnel.env"),
	}
	if err := tmpl.Execute(&buf, data); err != nil {
		return nil, fmt.Errorf("rendering %s template: %w", name, err)
	}
	return buf.Bytes(), nil
}

// systemctl runs a systemctl command and wraps non-zero exits with the
// command's stderr, so callers see the actual systemd error instead of just
// "exit status 1".
func systemctl(args ...string) error {
	out, err := exec.Command("systemctl", args...).CombinedOutput() //nolint:gosec // args are hardcoded by callers, never user input
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			return fmt.Errorf("systemctl %s: %w", strings.Join(args, " "), err)
		}
		return fmt.Errorf("systemctl %s: %w: %s", strings.Join(args, " "), err, msg)
	}
	return nil
}

// installService writes the templated compose file and systemd unit file
// to disk, reloads systemd, and enables the service. It does not start the
// service — the caller (`jib cloudflare setup`) is responsible for that.
// Must be run as root.
func installService() error {
	if os.Geteuid() != 0 {
		return errors.New("must be run as root")
	}
	cloudflaredDir, composePath := cloudflaredPaths()
	compose, err := render("compose", composeFile)
	if err != nil {
		return err
	}
	unit, err := render("unit", systemdUnit)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(cloudflaredDir, 0o750); err != nil { //nolint:gosec // needs group read for docker
		return fmt.Errorf("creating %s: %w", cloudflaredDir, err)
	}
	// docker-compose.yml is world-readable so the docker daemon can read it.
	if err := os.WriteFile(composePath, compose, 0o644); err != nil { //nolint:gosec // compose file is world-readable by design
		return fmt.Errorf("writing compose file: %w", err)
	}
	// Systemd unit files are world-readable by convention.
	if err := os.WriteFile(unitPath, unit, 0o644); err != nil { //nolint:gosec // unit file is world-readable by design
		return fmt.Errorf("writing unit file: %w", err)
	}
	if err := systemctl("daemon-reload"); err != nil {
		return err
	}
	return systemctl("enable", serviceName)
}

// uninstallService disables and stops the service, removes every file that
// installService wrote, and reloads systemd. Missing pieces are not treated
// as errors. Must be run as root.
func uninstallService() error {
	if os.Geteuid() != 0 {
		return errors.New("must be run as root")
	}
	cloudflaredDir, composePath := cloudflaredPaths()
	// Stopping the unit triggers ExecStop (docker compose down), tearing
	// down the container before we remove the compose file out from under it.
	_ = systemctl("disable", serviceName)
	_ = systemctl("stop", serviceName)

	for _, p := range []string{unitPath, composePath} {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("removing %s: %w", p, err)
		}
	}
	// Best-effort: remove cloudflaredDir if empty.
	_ = os.Remove(cloudflaredDir)

	return systemctl("daemon-reload")
}

// printInfo writes service metadata as JSON to stdout for discovery by
// orchestrators (e.g. `jib setup`).
func printInfo() {
	_, composePath := cloudflaredPaths()
	info := map[string]string{
		"name":         serviceName,
		"version":      version,
		"description":  serviceDescription,
		"unit_path":    unitPath,
		"compose_path": composePath,
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(info)
}
