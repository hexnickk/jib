// Package module defines the interface for jib's modular integration system.
// Each integration (GitHub, Cloudflare, nginx) implements one or more
// interfaces and registers itself with the global registry. Core code queries
// the registry for capabilities instead of importing specific integration
// packages.
package module

import (
	"context"

	"github.com/hexnickk/jib/internal/config"
)

// Module is the base interface all modules implement.
type Module interface {
	Name() string
}

// SetupHook runs during `jib add` and `jib remove` to provision or tear down
// integration resources (e.g. nginx configs, tunnel routes).
type SetupHook interface {
	Module
	OnAppAdd(ctx context.Context, app string, appCfg config.App, cfg *config.Config) error
	OnAppRemove(ctx context.Context, app string, appCfg config.App, cfg *config.Config) error
}

// GitAuthProvider supplies git authentication for the daemon poller.
// RefreshAuth is called before each git fetch. It should configure the repo's
// remote with fresh credentials if applicable. Returns (true, nil) if it
// handled auth for this app, (false, nil) to defer to the next provider.
type GitAuthProvider interface {
	Module
	RefreshAuth(ctx context.Context, root, repoDir string, appCfg config.App, cfg *config.Config) (handled bool, err error)
}
