package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// unitPath is where the systemd unit file is written during install.
const unitPath = "/etc/systemd/system/" + serviceName + ".service"

// cloudflaredDir holds the docker-compose.yml that backs the jib-cloudflared
// systemd unit. The tunnel token is NOT written here — it lives under
// /opt/jib/secrets/_jib/cloudflare/tunnel-token (via config.CredsPath) and is
// written by `jib cloudflare setup`.
const (
	cloudflaredDir = "/opt/jib/cloudflared"
	composePath    = cloudflaredDir + "/docker-compose.yml"
)

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

// installService writes the embedded compose file and systemd unit file to
// disk, reloads systemd, and enables the service. It does not start the
// service — the caller (`jib cloudflare setup`) is responsible for that.
// Must be run as root.
func installService() error {
	if os.Geteuid() != 0 {
		return errors.New("must be run as root")
	}
	if err := os.MkdirAll(cloudflaredDir, 0o750); err != nil { //nolint:gosec // needs group read for docker
		return fmt.Errorf("creating %s: %w", cloudflaredDir, err)
	}
	// docker-compose.yml is world-readable so the docker daemon can read it.
	if err := os.WriteFile(composePath, composeFile, 0o644); err != nil { //nolint:gosec // compose file is world-readable by design
		return fmt.Errorf("writing compose file: %w", err)
	}
	// Systemd unit files are world-readable by convention.
	if err := os.WriteFile(unitPath, systemdUnit, 0o644); err != nil { //nolint:gosec // unit file is world-readable by design
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
