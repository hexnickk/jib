package main

import (
	"github.com/spf13/cobra"
)

func registerDeployCommands(rootCmd *cobra.Command) {
	// jib deploy <app>
	deployCmd := &cobra.Command{
		Use:   "deploy <app>",
		Short: "Build and deploy an app",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	}
	deployCmd.Flags().String("ref", "", "Git ref (SHA, branch, tag) to deploy")
	deployCmd.Flags().Bool("dry-run", false, "Show what would happen without making changes")
	deployCmd.Flags().Bool("force", false, "Deploy even if already at target SHA")
	rootCmd.AddCommand(deployCmd)

	// jib rollback <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "rollback <app>",
		Short: "Swap to previous version",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	})

	// jib resume <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "resume <app>",
		Short: "Reset failures, unpin, re-enable autodeploy",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	})

	// jib webhook setup
	webhookCmd := &cobra.Command{
		Use:   "webhook",
		Short: "Webhook management",
	}
	webhookCmd.AddCommand(&cobra.Command{
		Use:   "setup",
		Short: "Generate secret, print GitHub webhook URL",
		RunE:  notImplemented,
	})
	rootCmd.AddCommand(webhookCmd)
}
