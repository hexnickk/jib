package main

import (
	"github.com/spf13/cobra"
)

func registerDaemonCommands(rootCmd *cobra.Command) {
	// jib serve
	rootCmd.AddCommand(&cobra.Command{
		Use:   "serve",
		Short: "Start the jib daemon (autodeploy + backups + monitoring)",
		RunE:  notImplemented,
	})
}
