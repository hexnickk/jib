package main

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
)

// registerContainerCommands wires up the per-app container lifecycle
// verbs: up, down, restart. Shell-access verbs (exec, run) live in
// shell.go because they share a distinct argv-parsing concern.
func registerContainerCommands(rootCmd *cobra.Command) {
	rootCmd.AddCommand(&cobra.Command{
		Use:   "up <app>",
		Short: "Start existing containers without rebuilding or pulling",
		Args:  exactArgs(1),
		RunE:  runUp,
	})

	rootCmd.AddCommand(&cobra.Command{
		Use:   "down <app>",
		Short: "Stop containers without removing app from config",
		Long:  "Stop containers without removing app from config.\n\nTo bring the app back up without redeploying, use 'jib up <app>'.",
		Args:  exactArgs(1),
		RunE:  runDown,
	})

	rootCmd.AddCommand(&cobra.Command{
		Use:   "restart <app>",
		Short: "Restart containers without redeploying",
		Args:  exactArgs(1),
		RunE:  runRestart,
	})
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
