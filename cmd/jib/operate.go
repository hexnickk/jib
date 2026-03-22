package main

import (
	"context"
	"fmt"

	"github.com/hexnickk/jib/internal/docker"
	"github.com/spf13/cobra"
)

func registerOperateCommands(rootCmd *cobra.Command) {
	// jib down <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "down <app>",
		Short: "Stop containers without removing app from config",
		Args:  cobra.ExactArgs(1),
		RunE:  runDown,
	})

	// jib restart <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "restart <app>",
		Short: "Restart containers without redeploying",
		Args:  cobra.ExactArgs(1),
		RunE:  runRestart,
	})

	// jib exec <app> [service] -- <cmd>
	execCmd := &cobra.Command{
		Use:                "exec <app> [service] -- <cmd>",
		Short:              "Execute command in running container",
		Args:               cobra.MinimumNArgs(1),
		DisableFlagParsing: true,
		RunE:               runExec,
	}
	rootCmd.AddCommand(execCmd)

	// jib run <app> <service> [-- <cmd>]
	runCmd := &cobra.Command{
		Use:                "run <app> <service> [-- <cmd>]",
		Short:              "Run a one-off command in a new container",
		Args:               cobra.MinimumNArgs(2),
		DisableFlagParsing: true,
		RunE:               runRun,
	}
	rootCmd.AddCommand(runCmd)

	// jib backup <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "backup <app>",
		Short: "Create a backup of app data",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("[backup] Would create a backup of app %q data.\n", args[0])
			fmt.Println("  This requires backup destination configuration and rclone.")
			return nil
		},
	})

	// jib restore <app>
	restoreCmd := &cobra.Command{
		Use:   "restore <app>",
		Short: "Restore app data from a backup",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			from, _ := cmd.Flags().GetString("from")
			dryRun, _ := cmd.Flags().GetBool("dry-run")
			fmt.Printf("[restore] Would restore app %q data.\n", args[0])
			if from != "" {
				fmt.Printf("  From: %s\n", from)
			}
			if dryRun {
				fmt.Println("  Dry-run mode: would download and verify without restoring.")
			}
			return nil
		},
	}
	restoreCmd.Flags().String("from", "", "Timestamp or backup ID to restore from")
	restoreCmd.Flags().Bool("dry-run", false, "Download and verify without restoring")
	restoreCmd.Flags().Bool("force", false, "Skip confirmation prompt")
	rootCmd.AddCommand(restoreCmd)

	// jib cleanup
	rootCmd.AddCommand(&cobra.Command{
		Use:   "cleanup",
		Short: "Clean up old images, volumes, and build cache",
		RunE:  runCleanup,
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
		RunE:  runSecretsSet,
	}
	secretsSetCmd.Flags().String("file", "", "Path to secrets file")
	_ = secretsSetCmd.MarkFlagRequired("file")
	secretsCmd.AddCommand(secretsSetCmd)
	secretsCmd.AddCommand(&cobra.Command{
		Use:   "check [app]",
		Short: "Check that required secrets are present",
		Args:  cobra.MaximumNArgs(1),
		RunE:  runSecretsCheck,
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
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("[cron add] Would add a scheduled task for app %q.\n", args[0])
			return nil
		},
	})
	cronCmd.AddCommand(&cobra.Command{
		Use:   "list <app>",
		Short: "List scheduled tasks for an app",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("[cron list] Would list scheduled tasks for app %q.\n", args[0])
			return nil
		},
	})
	cronCmd.AddCommand(&cobra.Command{
		Use:   "remove <app>",
		Short: "Remove a scheduled task for an app",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("[cron remove] Would remove a scheduled task for app %q.\n", args[0])
			return nil
		},
	})
	cronCmd.AddCommand(&cobra.Command{
		Use:   "run <app>",
		Short: "Run a scheduled task immediately",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("[cron run] Would run a scheduled task for app %q immediately.\n", args[0])
			return nil
		},
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
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Println("[tunnel setup] Would run interactive Cloudflare Tunnel or Tailscale setup.")
			return nil
		},
	})
	tunnelCmd.AddCommand(&cobra.Command{
		Use:   "status",
		Short: "Show tunnel connection status",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Println("[tunnel status] Would show tunnel connection status.")
			return nil
		},
	})
	rootCmd.AddCommand(tunnelCmd)

	// jib upgrade
	rootCmd.AddCommand(&cobra.Command{
		Use:   "upgrade",
		Short: "Self-update jib binary",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Println("[upgrade] Would download the latest jib binary and replace the current one.")
			return nil
		},
	})

	// jib nuke
	nukeCmd := &cobra.Command{
		Use:   "nuke",
		Short: "Remove everything jib-related from the machine",
		RunE: func(cmd *cobra.Command, args []string) error {
			force, _ := cmd.Flags().GetBool("force")
			fmt.Println("[nuke] Would remove everything jib-related from this machine:")
			fmt.Println("  - /opt/jib/ (config, state, repos, secrets)")
			fmt.Println("  - nginx configs in /etc/nginx/conf.d/")
			fmt.Println("  - systemd service units")
			fmt.Println("  - docker containers and images for all jib apps")
			if !force {
				fmt.Println("  Use --force to skip confirmation prompt.")
			}
			return nil
		},
	}
	nukeCmd.Flags().Bool("force", false, "Skip confirmation prompt")
	rootCmd.AddCommand(nukeCmd)
}

func runDown(cmd *cobra.Command, args []string) error {
	appName := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	compose, err := newCompose(cfg, appName)
	if err != nil {
		return err
	}

	if err := compose.Down(context.Background()); err != nil {
		return fmt.Errorf("stopping %s: %w", appName, err)
	}

	fmt.Printf("Stopped %s.\n", appName)
	return nil
}

func runRestart(cmd *cobra.Command, args []string) error {
	appName := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	compose, err := newCompose(cfg, appName)
	if err != nil {
		return err
	}

	if err := compose.Restart(context.Background(), nil); err != nil {
		return fmt.Errorf("restarting %s: %w", appName, err)
	}

	fmt.Printf("Restarted %s.\n", appName)
	return nil
}

// parseExecArgs parses "jib exec <app> [service] -- <cmd...>" from raw args.
// Since DisableFlagParsing is true, we receive the full args slice.
func parseExecArgs(args []string) (appName, service string, cmdArgs []string, err error) {
	if len(args) == 0 {
		return "", "", nil, fmt.Errorf("app name is required")
	}

	appName = args[0]
	rest := args[1:]

	// Find "--" separator
	dashIdx := -1
	for i, a := range rest {
		if a == "--" {
			dashIdx = i
			break
		}
	}

	if dashIdx == -1 {
		// No "--", treat everything after app as command (service defaults to first)
		if len(rest) == 0 {
			return "", "", nil, fmt.Errorf("command is required after app name")
		}
		// If only one arg after app, it could be service name or command
		// Convention: if there's no --, first arg is service, rest is command
		service = rest[0]
		cmdArgs = rest[1:]
		return appName, service, cmdArgs, nil
	}

	// Has "--" separator
	beforeDash := rest[:dashIdx]
	afterDash := rest[dashIdx+1:]

	if len(beforeDash) > 0 {
		service = beforeDash[0]
	}
	cmdArgs = afterDash

	return appName, service, cmdArgs, nil
}

func runExec(cmd *cobra.Command, args []string) error {
	appName, service, cmdArgs, err := parseExecArgs(args)
	if err != nil {
		return err
	}

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	compose, err := newCompose(cfg, appName)
	if err != nil {
		return err
	}

	return compose.Exec(context.Background(), service, cmdArgs)
}

// parseRunArgs parses "jib run <app> <service> [-- <cmd...>]" from raw args.
func parseRunArgs(args []string) (appName, service string, cmdArgs []string, err error) {
	if len(args) < 2 {
		return "", "", nil, fmt.Errorf("app name and service are required")
	}

	appName = args[0]
	service = args[1]
	rest := args[2:]

	// Find "--" separator
	dashIdx := -1
	for i, a := range rest {
		if a == "--" {
			dashIdx = i
			break
		}
	}

	if dashIdx == -1 {
		cmdArgs = rest
	} else {
		cmdArgs = rest[dashIdx+1:]
	}

	return appName, service, cmdArgs, nil
}

func runRun(cmd *cobra.Command, args []string) error {
	appName, service, cmdArgs, err := parseRunArgs(args)
	if err != nil {
		return err
	}

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	compose, err := newCompose(cfg, appName)
	if err != nil {
		return err
	}

	return compose.Run(context.Background(), service, cmdArgs)
}

func runCleanup(cmd *cobra.Command, args []string) error {
	fmt.Println("Pruning unused Docker images...")
	if err := docker.PruneImages(context.Background()); err != nil {
		return fmt.Errorf("cleanup failed: %w", err)
	}
	fmt.Println("Done.")
	return nil
}

func runSecretsSet(cmd *cobra.Command, args []string) error {
	appName := args[0]
	filePath, _ := cmd.Flags().GetString("file")

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	appCfg, ok := cfg.Apps[appName]
	if !ok {
		return fmt.Errorf("app %q not found in config", appName)
	}

	mgr := newSecretsManager()
	if err := mgr.Set(appName, filePath, appCfg.EnvFile); err != nil {
		return fmt.Errorf("setting secrets for %s: %w", appName, err)
	}

	fmt.Printf("Secrets set for %s.\n", appName)
	return nil
}

func runSecretsCheck(cmd *cobra.Command, args []string) error {
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	mgr := newSecretsManager()

	if len(args) == 1 {
		// Check a single app
		appName := args[0]
		appCfg, ok := cfg.Apps[appName]
		if !ok {
			return fmt.Errorf("app %q not found in config", appName)
		}
		if !appCfg.SecretsEnv {
			fmt.Printf("App %q does not use secrets_env.\n", appName)
			return nil
		}
		exists, path := mgr.Check(appName, appCfg.EnvFile)
		if exists {
			fmt.Printf("OK  %s  %s\n", appName, path)
		} else {
			fmt.Printf("MISSING  %s  %s\n", appName, path)
			return fmt.Errorf("secrets file missing for %s", appName)
		}
		return nil
	}

	// Check all apps
	results := mgr.CheckAll(cfg.Apps)
	if len(results) == 0 {
		fmt.Println("No apps require secrets_env.")
		return nil
	}

	allOK := true
	for _, r := range results {
		if r.Exists {
			fmt.Printf("OK       %s  %s\n", r.App, r.Path)
		} else {
			fmt.Printf("MISSING  %s  %s\n", r.App, r.Path)
			allOK = false
		}
	}

	if !allOK {
		return fmt.Errorf("some secrets files are missing")
	}
	return nil
}
