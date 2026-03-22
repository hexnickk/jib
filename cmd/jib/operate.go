package main

import (
	"github.com/spf13/cobra"
)

func registerOperateCommands(rootCmd *cobra.Command) {
	// jib down <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "down <app>",
		Short: "Stop containers without removing app from config",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	})

	// jib restart <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "restart <app>",
		Short: "Restart containers without redeploying",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	})

	// jib exec <app> [service] -- <cmd>
	execCmd := &cobra.Command{
		Use:                "exec <app> [service] -- <cmd>",
		Short:              "Execute command in running container",
		Args:               cobra.MinimumNArgs(1),
		DisableFlagParsing: true,
		RunE:               notImplemented,
	}
	rootCmd.AddCommand(execCmd)

	// jib run <app> <service> [-- <cmd>]
	runCmd := &cobra.Command{
		Use:                "run <app> <service> [-- <cmd>]",
		Short:              "Run a one-off command in a new container",
		Args:               cobra.MinimumNArgs(2),
		DisableFlagParsing: true,
		RunE:               notImplemented,
	}
	rootCmd.AddCommand(runCmd)

	// jib backup <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "backup <app>",
		Short: "Create a backup of app data",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	})

	// jib restore <app>
	restoreCmd := &cobra.Command{
		Use:   "restore <app>",
		Short: "Restore app data from a backup",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	}
	restoreCmd.Flags().String("from", "", "Timestamp or backup ID to restore from")
	restoreCmd.Flags().Bool("dry-run", false, "Download and verify without restoring")
	restoreCmd.Flags().Bool("force", false, "Skip confirmation prompt")
	rootCmd.AddCommand(restoreCmd)

	// jib cleanup
	rootCmd.AddCommand(&cobra.Command{
		Use:   "cleanup",
		Short: "Clean up old images, volumes, and build cache",
		RunE:  notImplemented,
	})

	// jib secrets
	secretsCmd := &cobra.Command{
		Use:              "secrets",
		Short:            "Manage app secrets",
		TraverseChildren: true,
	}
	secretsSetCmd := &cobra.Command{
		Use:   "set <app>",
		Short: "Set secrets for an app from a file",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	}
	secretsSetCmd.Flags().String("file", "", "Path to secrets file")
	_ = secretsSetCmd.MarkFlagRequired("file")
	secretsCmd.AddCommand(secretsSetCmd)
	secretsCmd.AddCommand(&cobra.Command{
		Use:   "check [app]",
		Short: "Check that required secrets are present",
		Args:  cobra.MaximumNArgs(1),
		RunE:  notImplemented,
	})
	rootCmd.AddCommand(secretsCmd)

	// jib cron <app>
	cronCmd := &cobra.Command{
		Use:   "cron",
		Short: "Manage scheduled tasks per app",
	}
	cronCmd.AddCommand(&cobra.Command{
		Use:   "add <app>",
		Short: "Add a scheduled task for an app",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	})
	cronCmd.AddCommand(&cobra.Command{
		Use:   "list <app>",
		Short: "List scheduled tasks for an app",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	})
	cronCmd.AddCommand(&cobra.Command{
		Use:   "remove <app>",
		Short: "Remove a scheduled task for an app",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	})
	cronCmd.AddCommand(&cobra.Command{
		Use:   "run <app>",
		Short: "Run a scheduled task immediately",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	})
	rootCmd.AddCommand(cronCmd)

	// jib tunnel
	tunnelCmd := &cobra.Command{
		Use:   "tunnel",
		Short: "Manage Cloudflare Tunnel or Tailscale setup",
	}
	tunnelCmd.AddCommand(&cobra.Command{
		Use:   "setup",
		Short: "Interactive Cloudflare Tunnel or Tailscale setup",
		RunE:  notImplemented,
	})
	tunnelCmd.AddCommand(&cobra.Command{
		Use:   "status",
		Short: "Show tunnel connection status",
		RunE:  notImplemented,
	})
	rootCmd.AddCommand(tunnelCmd)

	// jib upgrade
	rootCmd.AddCommand(&cobra.Command{
		Use:   "upgrade",
		Short: "Self-update jib binary",
		RunE:  notImplemented,
	})

	// jib nuke
	nukeCmd := &cobra.Command{
		Use:   "nuke",
		Short: "Remove everything jib-related from the machine",
		RunE:  notImplemented,
	}
	nukeCmd.Flags().Bool("force", false, "Skip confirmation prompt")
	rootCmd.AddCommand(nukeCmd)
}
