package config

import (
	"os"
	"path/filepath"
)

const defaultRoot = "/opt/jib"

// Root returns the base directory for all jib data.
// Defaults to /opt/jib, overridable with JIB_ROOT env var.
func Root() string {
	if root := os.Getenv("JIB_ROOT"); root != "" {
		return root
	}
	return defaultRoot
}

// ConfigFile returns the path to the jib config file.
func ConfigFile() string { return filepath.Join(Root(), "config.yml") }

// StateDir returns the directory for app state files.
func StateDir() string { return filepath.Join(Root(), "state") }

// LockDir returns the directory for lock files.
func LockDir() string { return filepath.Join(Root(), "locks") }

// SecretsDir returns the base directory for secrets.
func SecretsDir() string { return filepath.Join(Root(), "secrets") }

// OverrideDir returns the directory for generated compose override files.
func OverrideDir() string { return filepath.Join(Root(), "overrides") }

// StackDir returns the directory for the service stack compose file.
func StackDir() string { return filepath.Join(Root(), "stack") }

// RepoRoot returns the path to the jib source repo for building service images.
func RepoRoot() string { return filepath.Join(Root(), "src") }

// ReposDir returns the base directory for app git checkouts.
func ReposDir() string { return filepath.Join(Root(), "repos") }

// LogDir returns the directory for history log files.
func LogDir() string { return filepath.Join(Root(), "logs") }

// NginxDir returns the directory for jib-managed nginx configs.
func NginxDir() string { return filepath.Join(Root(), "nginx") }

// JibSecretsDir returns the path for jib's own secrets (tunnel tokens, API tokens, etc.).
func JibSecretsDir() string { return filepath.Join(Root(), "secrets", "_jib") }

// CredsPath returns the path for a jib credential file under _jib/<kind>/<name>.
// Kind groups related credentials (e.g. "cloudflare", "github-app")
// and name identifies the specific credential within that group.
func CredsPath(kind, name string) string { return filepath.Join(JibSecretsDir(), kind, name) }
