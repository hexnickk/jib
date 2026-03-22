package main

import (
	"github.com/spf13/cobra"
)

func registerConfigCommands(rootCmd *cobra.Command) {
	// jib config
	configCmd := &cobra.Command{
		Use:   "config",
		Short: "Read and write jib configuration",
	}
	configCmd.AddCommand(&cobra.Command{
		Use:   "get <key>",
		Short: "Read a config value",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	})
	configCmd.AddCommand(&cobra.Command{
		Use:   "set <key> <value>",
		Short: "Write a config value",
		Args:  cobra.ExactArgs(2),
		RunE:  notImplemented,
	})
	configCmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "Show all config (secrets redacted)",
		RunE:  notImplemented,
	})
	rootCmd.AddCommand(configCmd)

	// jib notify
	notifyCmd := &cobra.Command{
		Use:   "notify",
		Short: "Manage notification channels",
	}
	notifyCmd.AddCommand(&cobra.Command{
		Use:   "setup <channel>",
		Short: "Interactive setup for telegram|slack|discord|webhook",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	})
	notifyCmd.AddCommand(&cobra.Command{
		Use:   "test [channel]",
		Short: "Send test notification",
		Args:  cobra.MaximumNArgs(1),
		RunE:  notImplemented,
	})
	notifyCmd.AddCommand(&cobra.Command{
		Use:   "remove <channel>",
		Short: "Remove a notification channel",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	})
	notifyCmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "Show configured channels and status",
		RunE:  notImplemented,
	})
	rootCmd.AddCommand(notifyCmd)

	// jib backup-dest
	backupDestCmd := &cobra.Command{
		Use:   "backup-dest",
		Short: "Manage backup destinations",
	}
	backupDestCmd.AddCommand(&cobra.Command{
		Use:   "setup [name]",
		Short: "Interactive backup destination setup",
		Args:  cobra.MaximumNArgs(1),
		RunE:  notImplemented,
	})
	backupDestCmd.AddCommand(&cobra.Command{
		Use:   "remove <name>",
		Short: "Remove a backup destination",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	})
	backupDestCmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "Show configured backup destinations",
		RunE:  notImplemented,
	})
	rootCmd.AddCommand(backupDestCmd)
}
