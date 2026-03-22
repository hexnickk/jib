package main

import (
	"github.com/spf13/cobra"
)

func registerObserveCommands(rootCmd *cobra.Command) {
	// jib status [app]
	statusCmd := &cobra.Command{
		Use:   "status [app]",
		Short: "Show status of all apps or a specific app",
		Args:  cobra.MaximumNArgs(1),
		RunE:  notImplemented,
	}
	statusCmd.Flags().Bool("json", false, "Output in JSON format")
	rootCmd.AddCommand(statusCmd)

	// jib logs <app> [service]
	logsCmd := &cobra.Command{
		Use:   "logs <app> [service]",
		Short: "Show container logs",
		Args:  cobra.RangeArgs(1, 2),
		RunE:  notImplemented,
	}
	logsCmd.Flags().BoolP("follow", "f", false, "Follow log output")
	logsCmd.Flags().Int("tail", 100, "Number of lines to show from the end")
	rootCmd.AddCommand(logsCmd)

	// jib history <app>
	historyCmd := &cobra.Command{
		Use:   "history <app>",
		Short: "Deploy/rollback/backup timeline",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	}
	historyCmd.Flags().Int("limit", 0, "Maximum number of entries to show (0 = all)")
	historyCmd.Flags().Bool("json", false, "Output in JSON format")
	rootCmd.AddCommand(historyCmd)

	// jib env <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "env <app>",
		Short: "Show env vars (secrets redacted)",
		Args:  cobra.ExactArgs(1),
		RunE:  notImplemented,
	})

	// jib apps
	rootCmd.AddCommand(&cobra.Command{
		Use:   "apps",
		Short: "List all apps with status summary",
		RunE:  notImplemented,
	})

	// jib doctor
	rootCmd.AddCommand(&cobra.Command{
		Use:   "doctor",
		Short: "Check everything: deps, nginx, docker, daemon, certs, secrets",
		RunE:  notImplemented,
	})

	// jib metrics [app] [service]
	metricsCmd := &cobra.Command{
		Use:   "metrics [app] [service]",
		Short: "Live container stats (cpu, mem, net)",
		Args:  cobra.MaximumNArgs(2),
		RunE:  notImplemented,
	}
	metricsCmd.Flags().Bool("watch", false, "Continuously update metrics")
	rootCmd.AddCommand(metricsCmd)
}
