package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/stack"
	"github.com/hexnickk/jib/internal/tui"
	"github.com/spf13/cobra"
)

func registerTailscaleCommands(rootCmd *cobra.Command) {
	tsCmd := &cobra.Command{
		Use:   "tailscale",
		Short: "Manage Tailscale integration",
	}

	tsCmd.AddCommand(&cobra.Command{
		Use:   "setup",
		Short: "Install Tailscale, authenticate, and display connection info",
		Args:  cobra.NoArgs,
		RunE:  runTailscaleSetup,
	})

	tsCmd.AddCommand(&cobra.Command{
		Use:   "status",
		Short: "Show Tailscale connection status",
		Args:  cobra.NoArgs,
		RunE:  runTailscaleStatus,
	})

	rootCmd.AddCommand(tsCmd)
}

func runTailscaleSetup(cmd *cobra.Command, args []string) error {
	fmt.Println("Set up Tailscale for private networking and HTTPS.")
	fmt.Println()
	fmt.Println("This will start a Tailscale container connected to your Tailnet.")
	fmt.Println()
	fmt.Println("You'll need:")
	fmt.Println("  1. A Tailscale account — sign up at https://tailscale.com")
	fmt.Println("  2. An auth key — generate at https://login.tailscale.com/admin/settings/keys")
	fmt.Println("     (use a reusable key for server nodes)")
	fmt.Println()

	authKey, err := tui.PromptPassword("auth-key", "Tailscale auth key")
	if err != nil {
		return err
	}

	// Save auth key.
	authKeyPath := filepath.Join(jibRoot(), "secrets", "_jib", "tailscale-authkey")
	if err := os.MkdirAll(filepath.Dir(authKeyPath), 0o700); err != nil {
		return fmt.Errorf("creating secrets dir: %w", err)
	}
	if err := os.WriteFile(authKeyPath, []byte(authKey), 0o600); err != nil {
		return fmt.Errorf("saving auth key: %w", err)
	}

	// Save tunnel config.
	cfgPath := configPath()
	if err := config.ModifyRawConfig(cfgPath, func(raw map[string]interface{}) error {
		raw["tunnel"] = map[string]interface{}{"provider": "tailscale"}
		return nil
	}); err != nil {
		return fmt.Errorf("saving tunnel config: %w", err)
	}

	fmt.Println()
	fmt.Println("Tailscale configured.")
	syncStack()
	fmt.Println()
	fmt.Println("Your server will be accessible over your Tailscale network.")
	fmt.Println("Use 'jib status' to check the tailscale container status.")
	return nil
}

func runTailscaleStatus(cmd *cobra.Command, args []string) error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	if cfg.Tunnel == nil || cfg.Tunnel.Provider != "tailscale" {
		fmt.Println("Tailscale is not configured.")
		fmt.Println("Run 'jib tailscale setup' to get started.")
		return nil
	}

	fmt.Println("Tailscale: configured")
	out, err := stack.Status(context.Background())
	if err == nil && strings.Contains(out, "tailscale") {
		fmt.Println("  Container: running")
	} else {
		fmt.Println("  Container: not running")
	}

	return nil
}
