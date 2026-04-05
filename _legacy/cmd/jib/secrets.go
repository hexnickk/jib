package main

import (
	"fmt"

	"github.com/spf13/cobra"
)

// registerSecretsCommands wires up the `jib secrets` subcommands for bulk
// env-file management. Per-variable management was removed with observe.go
// — operators bulk-replace from a file and redeploy.
func registerSecretsCommands(rootCmd *cobra.Command) {
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
