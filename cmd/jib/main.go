package main

import (
	"fmt"
	"os"

	"github.com/hexnickk/jib/internal/module"
	"github.com/hexnickk/jib/internal/module/cfmod"
	"github.com/hexnickk/jib/internal/module/ghmod"
	"github.com/hexnickk/jib/internal/module/nginxmod"
	"github.com/spf13/cobra"
)

// version is set via ldflags at build time.
var version = "dev"

func main() {
	rootCmd := newRootCmd()
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func newRootCmd() *cobra.Command {
	// Register modules. Order matters for SetupHooks:
	// cloudflare routes before nginx (add), nginx before cloudflare (remove handled by iteration order).
	module.Register(&cfmod.Module{})
	module.Register(&nginxmod.Module{})
	module.Register(&ghmod.Module{})

	rootCmd := &cobra.Command{
		Use:   "jib",
		Short: "Lightweight Docker Compose deploy tool",
		Long: `Jib — Lightweight Docker Compose Deploy Tool

A single Go binary that deploys docker-compose apps on bare machines with
autodeploy, notifications, and reverse proxy management.
For small teams running 3-7 apps per machine.

Jib lives on the server. You SSH in and run commands, or use
"ssh <host> jib <command>" from your laptop.`,
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	// Version flag and command
	rootCmd.Version = version
	rootCmd.SetVersionTemplate("jib version {{.Version}}\n")

	// Core commands
	registerSetupCommands(rootCmd)
	registerDeployCommands(rootCmd)
	registerObserveCommands(rootCmd)
	registerOperateCommands(rootCmd)
	registerConfigCommands(rootCmd)

	// Module CLI commands
	registerGitHubCommands(rootCmd)
	registerCloudflareCommands(rootCmd)

	return rootCmd
}
