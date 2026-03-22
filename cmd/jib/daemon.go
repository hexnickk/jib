package main

import (
	"fmt"

	"github.com/spf13/cobra"
)

func registerDaemonCommands(rootCmd *cobra.Command) {
	// jib serve
	rootCmd.AddCommand(&cobra.Command{
		Use:   "serve",
		Short: "Start the jib daemon (autodeploy + backups + monitoring)",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Println("[serve] Would start the jib daemon with:")
			fmt.Println("  - Autodeploy polling loop")
			fmt.Println("  - Backup scheduler")
			fmt.Println("  - Health monitoring")
			fmt.Println("  - Webhook listener (if configured)")
			fmt.Println("  This command requires systemd and is meant to run as a service.")
			return nil
		},
	})
}
