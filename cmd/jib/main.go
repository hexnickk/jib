package main

import (
	"os"

	"github.com/spf13/cobra"
)

// version is set via ldflags at build time.
var version = "dev"

func main() {
	rootCmd := newRootCmd()
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func newRootCmd() *cobra.Command {
	rootCmd := &cobra.Command{
		Use:   "jib",
		Short: "Lightweight Docker Compose deploy tool",
		Long: `Jib — Lightweight Docker Compose Deploy Tool

A single Go binary that deploys docker-compose apps on bare machines with
zero-downtime (optional), auto-SSL, autodeploy, backups, and basic monitoring.
For small teams running 3-7 apps per machine.

Jib lives on the server. You SSH in and run commands, or use
"ssh <host> jib <command>" from your laptop.`,
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	// Version flag and command
	rootCmd.Version = version
	rootCmd.SetVersionTemplate("jib version {{.Version}}\n")

	// Register all command groups
	registerSetupCommands(rootCmd)
	registerDeployCommands(rootCmd)
	registerObserveCommands(rootCmd)
	registerOperateCommands(rootCmd)
	registerConfigCommands(rootCmd)
	registerDaemonCommands(rootCmd)

	return rootCmd
}
