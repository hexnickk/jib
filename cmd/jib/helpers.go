package main

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/docker"
	"github.com/hexnickk/jib/internal/secrets"
	"github.com/hexnickk/jib/internal/state"
	"github.com/spf13/cobra"
)

// sudoCmd creates an exec.Cmd that prepends "sudo" when not running as root.
func sudoCmd(name string, args ...string) *exec.Cmd {
	if os.Getuid() == 0 {
		return exec.Command(name, args...) //nolint:gosec // trusted CLI subprocess
	}
	return exec.Command("sudo", append([]string{name}, args...)...) //nolint:gosec // args are trusted internal values
}

// repoDir returns the on-disk path for an app's git checkout.
func repoDir(appName string, repo string) string {
	return config.RepoPath(appName, repo)
}

func loadConfig() (*config.Config, error) {
	return config.LoadConfig(config.ConfigFile())
}

func newStateStore() *state.Store {
	return state.NewStore(config.StateDir())
}

func newSecretsManager() *secrets.Manager {
	return secrets.NewManager(config.SecretsDir())
}

func newCompose(cfg *config.Config, appName string) (*docker.Compose, error) {
	appCfg, err := requireApp(cfg, appName)
	if err != nil {
		return nil, err
	}

	files := []string(appCfg.Compose)
	if len(files) == 0 {
		files = []string{"docker-compose.yml"}
	}

	envFile := ""
	mgr := newSecretsManager()
	if exists, _ := mgr.Check(appName, appCfg.EnvFile); exists {
		envFile = mgr.SymlinkPath(appName, appCfg.EnvFile)
	}

	dir := repoDir(appName, appCfg.Repo)

	return &docker.Compose{
		App:      appName,
		Dir:      dir,
		Files:    files,
		EnvFile:  envFile,
		Override: docker.OverridePath(config.OverrideDir(), appName),
	}, nil
}

// requireApp looks up an app in the config and returns it, or returns an error
// with a helpful message if it doesn't exist.
func requireApp(cfg *config.Config, appName string) (config.App, error) {
	appCfg, ok := cfg.Apps[appName]
	if !ok {
		return config.App{}, fmt.Errorf("app %q not found in config (see 'jib apps' for available apps)", appName)
	}
	return appCfg, nil
}

func currentUser() string {
	user := os.Getenv("USER")
	if user == "" {
		user = "unknown"
	}
	return user
}

// exactArgs returns a cobra.PositionalArgs validator that requires exactly n
// arguments, producing a descriptive error message that includes the command's
// Use string instead of cobra's generic "accepts N arg(s), received M".
func exactArgs(n int) cobra.PositionalArgs {
	return func(cmd *cobra.Command, args []string) error {
		if len(args) != n {
			return fmt.Errorf("requires exactly %d argument(s)\n\nUsage:\n  %s\n\nRun '%s --help' for more information",
				n, cmd.UseLine(), cmd.CommandPath())
		}
		return nil
	}
}

// minimumArgs returns a cobra.PositionalArgs validator that requires at least n
// arguments, producing a descriptive error message.
func minimumArgs(n int) cobra.PositionalArgs {
	return func(cmd *cobra.Command, args []string) error {
		if len(args) < n {
			return fmt.Errorf("requires at least %d argument(s)\n\nUsage:\n  %s\n\nRun '%s --help' for more information",
				n, cmd.UseLine(), cmd.CommandPath())
		}
		return nil
	}
}

// rangeArgs returns a cobra.PositionalArgs validator that requires between min
// and max arguments, producing a descriptive error message.
func rangeArgs(min, max int) cobra.PositionalArgs {
	return func(cmd *cobra.Command, args []string) error {
		if len(args) < min || len(args) > max {
			return fmt.Errorf("requires between %d and %d argument(s)\n\nUsage:\n  %s\n\nRun '%s --help' for more information",
				min, max, cmd.UseLine(), cmd.CommandPath())
		}
		return nil
	}
}
