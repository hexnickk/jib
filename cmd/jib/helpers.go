package main

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/docker"
	"github.com/hexnickk/jib/internal/secrets"
	"github.com/spf13/cobra"
)

// sudoCmd creates an exec.Cmd that prepends "sudo" when not running as root.
func sudoCmd(name string, args ...string) *exec.Cmd {
	if os.Getuid() == 0 {
		return exec.Command(name, args...) //nolint:gosec // trusted CLI subprocess
	}
	return exec.Command("sudo", append([]string{name}, args...)...) //nolint:gosec // args are trusted internal values
}

func loadConfig() (*config.Config, error) {
	return config.LoadConfig(config.ConfigFile())
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

	return &docker.Compose{
		App:      appName,
		Dir:      config.RepoPath(appName, appCfg.Repo),
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
		return config.App{}, fmt.Errorf("app %q not found in config (see 'jib config list' for configured apps)", appName)
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
