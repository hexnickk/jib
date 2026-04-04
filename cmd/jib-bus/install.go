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

// busDir holds the docker-compose.yml and nats.conf that back the jib-bus
// systemd unit. Keeping these as real files on disk (rather than embedded in
// the binary at runtime) gives operators a standard infrastructure-as-code
// location to inspect or override.
const (
	busDir      = "/opt/jib/bus"
	composePath = busDir + "/docker-compose.yml"
	confPath    = busDir + "/nats.conf"
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

// installService writes the embedded compose file, nats.conf, and systemd
// unit file to disk, reloads systemd, and enables the service. It does not
// start the service — the caller (or systemd on next boot) is responsible
// for that. Must be run as root.
func installService() error {
	if os.Geteuid() != 0 {
		return errors.New("must be run as root")
	}
	if err := os.MkdirAll(busDir, 0o750); err != nil { //nolint:gosec // bus dir needs group read for docker
		return fmt.Errorf("creating %s: %w", busDir, err)
	}
	// docker-compose.yml and nats.conf are world-readable so the docker
	// daemon (running as root or in the docker group) can read them without
	// ownership gymnastics.
	if err := os.WriteFile(composePath, composeFile, 0o644); err != nil { //nolint:gosec // compose file is world-readable by design
		return fmt.Errorf("writing compose file: %w", err)
	}
	if err := os.WriteFile(confPath, natsConf, 0o644); err != nil { //nolint:gosec // nats.conf is world-readable by design
		return fmt.Errorf("writing nats.conf: %w", err)
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

// uninstallService disables and stops the service, removes its unit file, and
// reloads systemd. Missing pieces (already stopped, already removed) are not
// treated as errors. Must be run as root.
func uninstallService() error {
	if os.Geteuid() != 0 {
		return errors.New("must be run as root")
	}
	// disable/stop may fail if the unit is already gone — intentionally ignored.
	_ = systemctl("disable", serviceName)
	_ = systemctl("stop", serviceName)
	if err := os.Remove(unitPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("removing unit file: %w", err)
	}
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
		"conf_path":    confPath,
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(info)
}
