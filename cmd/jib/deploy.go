package main

import (
	"context"
	"fmt"

	"github.com/hexnickk/jib/internal/deploy"
	"github.com/spf13/cobra"
)

func registerDeployCommands(rootCmd *cobra.Command) {
	// jib deploy <app>
	deployCmd := &cobra.Command{
		Use:   "deploy <app>",
		Short: "Build and deploy an app",
		Args:  exactArgs(1),
		RunE:  runDeploy,
	}
	deployCmd.Flags().String("ref", "", "Git ref (SHA, branch, tag) to deploy")
	deployCmd.Flags().Bool("dry-run", false, "Show what would happen without making changes")
	deployCmd.Flags().Bool("force", false, "Deploy even if already at target SHA")
	rootCmd.AddCommand(deployCmd)

	// jib rollback <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "rollback <app>",
		Short: "Swap to previous version",
		Args:  exactArgs(1),
		RunE:  runRollback,
	})

	// jib resume <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "resume <app>",
		Short: "Reset failures, unpin, re-enable autodeploy",
		Args:  exactArgs(1),
		RunE:  runResume,
	})

	// jib webhook setup
	webhookCmd := &cobra.Command{
		Use:   "webhook",
		Short: "Webhook management",
	}
	webhookCmd.AddCommand(&cobra.Command{
		Use:   "setup",
		Short: "Generate secret, print GitHub webhook URL",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Println("[webhook setup] Would generate a webhook secret and print the GitHub webhook URL.")
			fmt.Println("  This requires network access and GitHub API credentials.")
			return nil
		},
	})
	rootCmd.AddCommand(webhookCmd)
}

func runDeploy(cmd *cobra.Command, args []string) error {
	appName := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	ref, _ := cmd.Flags().GetString("ref")
	dryRun, _ := cmd.Flags().GetBool("dry-run")
	force, _ := cmd.Flags().GetBool("force")

	engine := newEngine(cfg)

	opts := deploy.DeployOptions{
		App:     appName,
		Ref:     ref,
		DryRun:  dryRun,
		Force:   force,
		Trigger: "manual",
		User:    currentUser(),
	}

	result, err := engine.Deploy(context.Background(), opts)
	if err != nil {
		return fmt.Errorf("deploy failed: %w", err)
	}

	if dryRun {
		fmt.Println("[dry-run] No changes were made.")
	}
	printDeployResult(result)
	if !result.Success {
		return fmt.Errorf("deploy completed with errors: %s", result.Error)
	}
	return nil
}

func runRollback(cmd *cobra.Command, args []string) error {
	appName := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	engine := newEngine(cfg)

	opts := deploy.RollbackOptions{
		App:  appName,
		User: currentUser(),
	}

	result, err := engine.Rollback(context.Background(), opts)
	if err != nil {
		return fmt.Errorf("rollback failed: %w", err)
	}

	printDeployResult(result)
	if !result.Success {
		return fmt.Errorf("rollback completed with errors: %s", result.Error)
	}
	return nil
}

func runResume(cmd *cobra.Command, args []string) error {
	appName := args[0]

	store := newStateStore()

	appState, err := store.Load(appName)
	if err != nil {
		return fmt.Errorf("loading state: %w", err)
	}

	appState.Pinned = false
	appState.ConsecutiveFailures = 0

	if err := store.Save(appName, appState); err != nil {
		return fmt.Errorf("saving state: %w", err)
	}

	fmt.Printf("Resumed app %q: pinned=false, consecutive_failures=0\n", appName)
	fmt.Println("Autodeploy will continue on next poll cycle.")
	return nil
}

func printDeployResult(r *deploy.DeployResult) {
	if r.Success {
		fmt.Printf("OK  %s deployed (%s strategy)\n", r.App, r.Strategy)
	} else {
		fmt.Printf("FAIL  %s deploy failed (%s strategy)\n", r.App, r.Strategy)
	}
	if r.PreviousSHA != "" {
		prev := r.PreviousSHA
		if len(prev) > 7 {
			prev = prev[:7]
		}
		fmt.Printf("  Previous: %s\n", prev)
	}
	if r.DeployedSHA != "" {
		deployed := r.DeployedSHA
		if len(deployed) > 7 {
			deployed = deployed[:7]
		}
		fmt.Printf("  Deployed: %s\n", deployed)
	}
	if r.Error != "" {
		fmt.Printf("  Error:    %s\n", r.Error)
	}
}
