// Package ghmod provides the GitHub authentication module for jib.
// It refreshes GitHub App installation tokens before git fetch operations
// in the daemon poller.
package ghmod

import (
	"context"

	"github.com/hexnickk/jib/internal/config"
	ghPkg "github.com/hexnickk/jib/internal/github"
	"github.com/hexnickk/jib/internal/module"
)

// Module implements module.GitAuthProvider for GitHub.
type Module struct{}

var _ module.GitAuthProvider = (*Module)(nil)

func (m *Module) Name() string { return "github" }

func (m *Module) RefreshAuth(ctx context.Context, root, repoDir string, appCfg config.App, cfg *config.Config) (bool, error) {
	if appCfg.Provider == "" {
		return false, nil
	}

	provider, ok := cfg.LookupProvider(appCfg.Provider)
	if !ok || provider.Type != ghPkg.ProviderTypeApp {
		return false, nil
	}

	token, err := ghPkg.GenerateInstallationToken(ctx, root, appCfg.Provider, provider.AppID, appCfg.Repo)
	if err != nil {
		return true, err
	}
	if err := ghPkg.SetRemoteToken(ctx, repoDir, appCfg.Repo, token); err != nil {
		return true, err
	}
	return true, nil
}
