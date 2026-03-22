package main

import (
	"github.com/spf13/cobra"
)

func registerSetupCommands(rootCmd *cobra.Command) {
	// jib init
	rootCmd.AddCommand(&cobra.Command{
		Use:   "init",
		Short: "Interactive onboarding: deps, user, config, first app",
		RunE:  notImplemented,
	})

	// jib add <app>
	addCmd := &cobra.Command{
		Use:   "add <app>",
		Short: "Add app: config + clone + key + nginx + SSL",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	}
	addCmd.Flags().String("repo", "", "GitHub repo (org/name)")
	addCmd.Flags().String("compose", "", "Compose file path (or comma-separated list)")
	addCmd.Flags().StringSlice("domain", nil, "Domain:port mapping (repeatable)")
	addCmd.Flags().StringSlice("health", nil, "Health check path:port (repeatable)")
	addCmd.Flags().Bool("config-only", false, "Write config without provisioning")
	rootCmd.AddCommand(addCmd)

	// jib provision [app]
	rootCmd.AddCommand(&cobra.Command{
		Use:   "provision [app]",
		Short: "Re-reconcile infra for app (or all) — idempotent",
		Args:  cobra.MaximumNArgs(1),
		RunE:  notImplemented,
	})

	// jib remove <app>
	removeCmd := &cobra.Command{
		Use:   "remove <app>",
		Short: "Remove an app",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	}
	removeCmd.Flags().Bool("force", false, "Skip confirmation prompt")
	rootCmd.AddCommand(removeCmd)

	// jib edit
	rootCmd.AddCommand(&cobra.Command{
		Use:   "edit",
		Short: "$EDITOR config.yml + validate on save",
		RunE:  notImplemented,
	})
}
