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

// busPaths returns the on-disk locations for jib-bus's managed files,
// rooted under config.BusDir() so JIB_ROOT is honored end-to-end. The
// systemd unit's ExecStart lines reference these paths, so the embedded
// unit file is templated at install time rather than written verbatim.
func busPaths() (dir, compose, conf string) {
	dir = config.BusDir()
	return dir, filepath.Join(dir, "docker-compose.yml"), filepath.Join(dir, "nats.conf")
}

// render templates an embedded file with the runtime paths so unit and
// compose references match wherever JIB_ROOT points. Same shape as the
// render helper in jib-cloudflared — kept inline rather than shared to
// avoid premature abstraction (two call sites, ~10 LoC each).
func render(name string, src []byte) ([]byte, error) {
	tmpl, err := template.New(name).Parse(string(src))
	if err != nil {
		return nil, fmt.Errorf("parsing %s template: %w", name, err)
	}
	var buf bytes.Buffer
	data := map[string]string{"BusDir": config.BusDir()}
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

// installService writes the embedded compose file, nats.conf, and templated
// systemd unit file to disk, reloads systemd, and enables the service. It
// does not start the service — the caller (or systemd on next boot) is
// responsible for that. Must be run as root.
func installService() error {
	if os.Geteuid() != 0 {
		return errors.New("must be run as root")
	}
	busDir, composePath, confPath := busPaths()
	unit, err := render("unit", systemdUnit)
	if err != nil {
		return err
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
	if err := os.WriteFile(unitPath, unit, 0o644); err != nil { //nolint:gosec // unit file is world-readable by design
		return fmt.Errorf("writing unit file: %w", err)
	}
	if err := systemctl("daemon-reload"); err != nil {
		return err
	}
	return systemctl("enable", serviceName)
}

// uninstallService disables and stops the service, removes every file that
// installService wrote (unit, compose, nats.conf), and reloads systemd.
// Missing pieces (already stopped, already removed) are not treated as
// errors. Must be run as root.
func uninstallService() error {
	if os.Geteuid() != 0 {
		return errors.New("must be run as root")
	}
	busDir, composePath, confPath := busPaths()
	// disable/stop may fail if the unit is already gone — intentionally ignored.
	// Stopping the unit triggers its ExecStop (docker compose down), tearing
	// down the containers before we remove the compose file out from under it.
	_ = systemctl("disable", serviceName)
	_ = systemctl("stop", serviceName)

	for _, p := range []string{unitPath, composePath, confPath} {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("removing %s: %w", p, err)
		}
	}
	// Best-effort: remove busDir if empty. Fails silently if the operator
	// left other files there, which we do not own.
	_ = os.Remove(busDir)

	return systemctl("daemon-reload")
}

// printInfo writes service metadata as JSON to stdout for discovery by
// orchestrators (e.g. `jib setup`).
func printInfo() {
	_, composePath, confPath := busPaths()
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
