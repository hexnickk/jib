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

// RepoRoot returns the path to the jib source repo for building service images.
func RepoRoot() string { return filepath.Join(Root(), "src") }

// ReposDir returns the base directory for app git checkouts.
func ReposDir() string { return filepath.Join(Root(), "repos") }

// NginxDir returns the directory for jib-managed nginx configs.
func NginxDir() string { return filepath.Join(Root(), "nginx") }

// BusDir returns the directory for jib-bus compose/conf files.
func BusDir() string { return filepath.Join(Root(), "bus") }

// CloudflaredDir returns the directory for jib-cloudflared compose files.
func CloudflaredDir() string { return filepath.Join(Root(), "cloudflared") }

// RepoPath returns the on-disk path for an app's git checkout under ReposDir.
// GitHub repos (org/name) go under repos/github/org/name.
// Local repos go under repos/local/<appName>.
func RepoPath(appName, repo string) string {
	return RepoPathIn(ReposDir(), appName, repo)
}

// RepoPathIn is like RepoPath but takes an explicit base directory, for tests
// and for the deployer which injects its RepoBaseDir for testability.
func RepoPathIn(base, appName, repo string) string {
	if repo == "local" || repo == "" {
		return filepath.Join(base, "local", appName)
	}
	return filepath.Join(base, "github", repo)
}

// CredsPath returns the path for a jib credential file under secrets/_jib/<kind>/<name>.
// Kind groups related credentials (e.g. "cloudflare", "github-app")
// and name identifies the specific credential within that group.
func CredsPath(kind, name string) string {
	return filepath.Join(Root(), "secrets", "_jib", kind, name)
}
