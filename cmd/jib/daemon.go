package main

import (
	"context"

	"github.com/hexnickk/jib/internal/daemon"
	"github.com/spf13/cobra"
)

func registerDaemonCommands(rootCmd *cobra.Command) {
	runDaemon := func(cmd *cobra.Command, args []string) error {
		d := daemon.New(jibRoot(), configPath())
		return d.Run(context.Background())
	}

	// jib _daemon — hidden internal command, run by systemd
	daemonCmd := &cobra.Command{
		Use:    "_daemon",
		Short:  "Start the jib daemon (internal — run by systemd)",
		Hidden: true,
		RunE:   runDaemon,
	}
	rootCmd.AddCommand(daemonCmd)

	// jib serve — user-facing alias for _daemon
	rootCmd.AddCommand(&cobra.Command{
		Use:   "serve",
		Short: "Start the jib daemon (autodeploy + backups + monitoring)",
		RunE:  runDaemon,
	})
}
