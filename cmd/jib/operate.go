package main

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
)

func registerOperateCommands(rootCmd *cobra.Command) {
	// jib up <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "up <app>",
		Short: "Start existing containers without rebuilding or pulling",
		Args:  exactArgs(1),
		RunE:  runUp,
	})

	// jib down <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "down <app>",
		Short: "Stop containers without removing app from config",
		Long:  "Stop containers without removing app from config.\n\nTo bring the app back up without redeploying, use 'jib up <app>'.",
		Args:  exactArgs(1),
		RunE:  runDown,
	})

	// jib restart <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "restart <app>",
		Short: "Restart containers without redeploying",
		Args:  exactArgs(1),
		RunE:  runRestart,
	})

	// jib exec <app> [service] -- <cmd>
	execCmd := &cobra.Command{
		Use:                "exec <app> [service] -- <cmd>",
		Short:              "Execute command in running container",
		DisableFlagParsing: true,
		RunE:               runExec,
	}
	rootCmd.AddCommand(execCmd)

	// jib run <app> <service> [-- <cmd>]
	runCmd := &cobra.Command{
		Use:                "run <app> <service> [-- <cmd>]",
		Short:              "Run a one-off command in a new container",
		DisableFlagParsing: true,
		RunE:               runRun,
	}
	rootCmd.AddCommand(runCmd)

	// jib secrets
	secretsCmd := &cobra.Command{
		Use:              "secrets",
		Short:            "Manage app secrets (bulk file import)",
		TraverseChildren: true,
	}
	secretsSetCmd := &cobra.Command{
		Use:   "set <app>",
		Short: "Import env vars from a file (bulk replace)",
		Args:  exactArgs(1),
		RunE:  runSecretsSet,
	}
	secretsSetCmd.Flags().String("file", "", "Path to secrets file")
	_ = secretsSetCmd.MarkFlagRequired("file")
	secretsCmd.AddCommand(secretsSetCmd)
	secretsCmd.AddCommand(&cobra.Command{
		Use:   "check [app]",
		Short: "Verify secrets file exists for an app",
		Args:  cobra.MaximumNArgs(1),
		RunE:  runSecretsCheck,
	})
	rootCmd.AddCommand(secretsCmd)

	// jib nuke — stub, hidden until implemented
	nukeCmd := &cobra.Command{
		Use:    "nuke",
		Short:  "Remove everything jib-related from the machine",
		Hidden: true,
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

func runUp(cmd *cobra.Command, args []string) error {
	appName := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	compose, err := newCompose(cfg, appName)
	if err != nil {
		return err
	}

	if err := compose.Up(context.Background(), nil); err != nil {
		return fmt.Errorf("starting %s: %w", appName, err)
	}

	fmt.Printf("Started %s.\n", appName)
	return nil
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
		return "", "", nil, fmt.Errorf("missing app name\n\nUsage:\n  jib exec <app> [service] -- <cmd>")
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
			return "", "", nil, fmt.Errorf("command is required after app name\n\nUsage:\n  jib exec <app> [service] -- <cmd>")
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
	// DisableFlagParsing is true, so we must handle --help manually.
	for _, a := range args {
		if a == "--help" || a == "-h" {
			return cmd.Help()
		}
	}

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
		return "", "", nil, fmt.Errorf("app name and service are required\n\nUsage:\n  jib run <app> <service> [-- <cmd>]")
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
	// DisableFlagParsing is true, so we must handle --help manually.
	for _, a := range args {
		if a == "--help" || a == "-h" {
			return cmd.Help()
		}
	}

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

func runSecretsSet(cmd *cobra.Command, args []string) error {
	appName := args[0]
	filePath, _ := cmd.Flags().GetString("file")

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	appCfg, err := requireApp(cfg, appName)
	if err != nil {
		return err
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
		appCfg, err := requireApp(cfg, appName)
		if err != nil {
			return err
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
