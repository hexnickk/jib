package main

import (
	"fmt"
	"log"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/hexnickk/jib/internal/bus"
	"github.com/hexnickk/jib/internal/deployrpc"
	"github.com/spf13/cobra"
)

const defaultDeployTimeout = 5 * time.Minute

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
	deployCmd.Flags().Duration("timeout", defaultDeployTimeout, "Max time to wait for deploy result")
	rootCmd.AddCommand(deployCmd)

	// jib rollback <app>
	rollbackCmd := &cobra.Command{
		Use:   "rollback <app>",
		Short: "Swap to previous version",
		Args:  exactArgs(1),
		RunE:  runRollback,
	}
	rollbackCmd.Flags().Duration("timeout", defaultDeployTimeout, "Max time to wait for rollback result")
	rootCmd.AddCommand(rollbackCmd)

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

// connectNATS connects to NATS with a short timeout for CLI use.
func connectNATS() (*bus.Bus, error) {
	logger := log.New(os.Stderr, "", 0)
	b, err := bus.Connect(bus.Options{URL: bus.DefaultURL}, logger)
	if err != nil {
		return nil, fmt.Errorf("cannot connect to NATS — run 'jib init' or check 'systemctl status jib-stack'\n  %w", err)
	}
	return b, nil
}

func runDeploy(cmd *cobra.Command, args []string) error {
	appName := args[0]
	ref, _ := cmd.Flags().GetString("ref")
	dryRun, _ := cmd.Flags().GetBool("dry-run")
	force, _ := cmd.Flags().GetBool("force")
	timeout, _ := cmd.Flags().GetDuration("timeout")

	b, err := connectNATS()
	if err != nil {
		return err
	}
	defer b.Close()

	correlationID := uuid.NewString()
	deployCmd := deployrpc.DeployCommand{
		Message: bus.NewMessage("cli"),
		App:     appName,
		Ref:     ref,
		Trigger: "manual",
		User:    currentUser(),
		Force:   force,
		DryRun:  dryRun,
	}
	deployCmd.CorrelationID = correlationID

	rpc := deployrpc.NewClient(b)
	ev, err := rpc.DeployAndWait(deployCmd.Subject(), deployCmd, correlationID, appName, timeout)
	if err != nil {
		return err
	}

	if dryRun {
		fmt.Println("[dry-run] No changes were made.")
	}
	printEventResult(ev)
	if ref != "" && ev.Status == deployrpc.StatusSuccess {
		fmt.Println("  Pinned: true (autodeploy paused — run 'jib resume' to unpin)")
	}
	if ev.Status != deployrpc.StatusSuccess {
		return fmt.Errorf("deploy completed with errors: %s", ev.Error)
	}
	return nil
}

func runRollback(cmd *cobra.Command, args []string) error {
	appName := args[0]
	timeout, _ := cmd.Flags().GetDuration("timeout")

	b, err := connectNATS()
	if err != nil {
		return err
	}
	defer b.Close()

	correlationID := uuid.NewString()
	rollbackCmd := deployrpc.RollbackCommand{
		Message: bus.NewMessage("cli"),
		App:     appName,
		User:    currentUser(),
	}
	rollbackCmd.CorrelationID = correlationID

	rpc := deployrpc.NewClient(b)
	ev, err := rpc.DeployAndWait(rollbackCmd.Subject(), rollbackCmd, correlationID, appName, timeout)
	if err != nil {
		return err
	}

	printEventResult(ev)
	if ev.Status != deployrpc.StatusSuccess {
		return fmt.Errorf("rollback completed with errors: %s", ev.Error)
	}
	return nil
}

func runResume(cmd *cobra.Command, args []string) error {
	appName := args[0]

	b, err := connectNATS()
	if err != nil {
		return err
	}
	defer b.Close()

	resumeCmd := deployrpc.ResumeCommand{
		Message: bus.NewMessage("cli"),
		App:     appName,
		User:    currentUser(),
	}

	rpc := deployrpc.NewClient(b)
	ack, err := rpc.RequestAck(resumeCmd.Subject(), resumeCmd)
	if err != nil {
		return err
	}
	if !ack.Accepted {
		return fmt.Errorf("resume rejected: %s", ack.Error)
	}

	fmt.Printf("Resumed app %q: pinned=false, consecutive_failures=0\n", appName)
	fmt.Println("Autodeploy will continue on next poll cycle.")
	return nil
}

// printEventResult prints a deploy event result.
func printEventResult(ev *deployrpc.DeployEvent) {
	if ev.Status == deployrpc.StatusSuccess {
		fmt.Printf("OK  %s deployed\n", ev.App)
	} else {
		fmt.Printf("FAIL  %s deploy failed\n", ev.App)
	}
	if ev.PreviousSHA != "" {
		prev := ev.PreviousSHA
		if len(prev) > 7 {
			prev = prev[:7]
		}
		fmt.Printf("  Previous: %s\n", prev)
	}
	if ev.SHA != "" {
		sha := ev.SHA
		if len(sha) > 7 {
			sha = sha[:7]
		}
		fmt.Printf("  Deployed: %s\n", sha)
	}
	if ev.Error != "" {
		fmt.Printf("  Error:    %s\n", ev.Error)
	}
}
