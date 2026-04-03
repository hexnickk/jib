package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/hexnickk/jib/internal/cloudflare"
	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/stack"
	"github.com/hexnickk/jib/internal/tui"
	"github.com/spf13/cobra"
)

func registerCloudflareCommands(rootCmd *cobra.Command) {
	cfCmd := &cobra.Command{
		Use:   "cloudflare",
		Short: "Manage Cloudflare Tunnel integration",
	}

	setupCmd := &cobra.Command{
		Use:   "setup",
		Short: "Install cloudflared and connect a tunnel",
		Args:  cobra.NoArgs,
		RunE:  runCloudflareSetup,
	}
	setupCmd.Flags().String("api-token", "", "Cloudflare API token (for non-interactive use)")
	setupCmd.Flags().String("tunnel-name", "", "Name for the tunnel (defaults to hostname)")
	cfCmd.AddCommand(setupCmd)

	cfCmd.AddCommand(&cobra.Command{
		Use:   "status",
		Short: "Show Cloudflare Tunnel status",
		Args:  cobra.NoArgs,
		RunE:  runCloudflareStatus,
	})

	rootCmd.AddCommand(cfCmd)
}

func runCloudflareSetup(cmd *cobra.Command, args []string) error {
	// Choose setup method
	apiToken, _ := cmd.Flags().GetString("api-token")
	tunnelName, _ := cmd.Flags().GetString("tunnel-name")

	if apiToken != "" {
		return runCloudflareAPISetup(apiToken, tunnelName)
	}

	if tui.IsInteractive() {
		method, err := tui.PromptSelect("How would you like to set up the tunnel?", []tui.SelectOption{
			{Label: "Automatic (API) — jib creates and manages the tunnel", Value: "api"},
			{Label: "Manual (dashboard) — paste a tunnel token", Value: "manual"},
		})
		if err != nil {
			return err
		}
		if method == "api" {
			return runCloudflareAPISetup("", tunnelName)
		}
	}

	return runCloudflareManualSetup()
}

func runCloudflareAPISetup(apiToken, tunnelName string) error {
	ctx := context.Background()

	if apiToken == "" {
		fmt.Println()
		fmt.Println("Create a Cloudflare API token at:")
		fmt.Println("  https://dash.cloudflare.com/profile/api-tokens")
		fmt.Println()
		fmt.Println("Use the 'Edit Cloudflare Tunnel' template, and also add:")
		fmt.Println("  Zone → DNS → Edit (for automatic DNS record creation)")
		fmt.Println()

		var err error
		apiToken, err = tui.PromptPassword("api-token", "Cloudflare API token")
		if err != nil {
			return err
		}
	}

	client := cloudflare.NewClient(apiToken)

	// Verify token and get account ID
	fmt.Println("\nVerifying API token...")
	accountID, err := client.VerifyToken(ctx)
	if err != nil {
		return fmt.Errorf("invalid token: %w", err)
	}
	fmt.Printf("  Account ID: %s\n", accountID)

	// Save API token
	tokenPath := cloudflareAPITokenPath()
	if err := os.MkdirAll(filepath.Dir(tokenPath), 0o700); err != nil {
		return fmt.Errorf("creating secrets directory: %w", err)
	}
	if err := os.WriteFile(tokenPath, []byte(apiToken), 0o600); err != nil {
		return fmt.Errorf("saving API token: %w", err)
	}

	// Create tunnel
	if tunnelName == "" {
		hostname, _ := os.Hostname()
		if hostname == "" {
			hostname = "jib"
		}
		tunnelName = "jib-" + hostname
	}

	fmt.Printf("\nCreating tunnel %q...\n", tunnelName)
	// Generate a random tunnel secret (32 bytes, base64 encoded as CF expects)
	secretBytes := make([]byte, 32)
	if _, err := rand.Read(secretBytes); err != nil {
		return fmt.Errorf("generating tunnel secret: %w", err)
	}
	tunnelSecret := base64.StdEncoding.EncodeToString(secretBytes)

	tunnel, err := client.CreateTunnel(ctx, accountID, tunnelName, tunnelSecret)
	if err != nil {
		return err
	}
	fmt.Printf("  Tunnel ID: %s\n", tunnel.ID)

	// Get the connector token
	token, err := client.GetTunnelToken(ctx, accountID, tunnel.ID)
	if err != nil {
		return err
	}

	// Save tunnel token for the stack container.
	tunnelTokenPath := filepath.Join(config.JibSecretsDir(), "cloudflare-tunnel-token")
	if err := os.WriteFile(tunnelTokenPath, []byte(token), 0o600); err != nil {
		return fmt.Errorf("saving tunnel token: %w", err)
	}

	// Initialize tunnel with catch-all 404
	_ = client.PutTunnelIngress(ctx, accountID, tunnel.ID, []cloudflare.IngressRule{
		{Service: "http_status:404"},
	})

	// Save tunnel config
	cfgPath := config.ConfigFile()
	if err := config.ModifyRawConfig(cfgPath, func(raw map[string]interface{}) error {
		tunnelCfg := map[string]interface{}{
			"provider":   "cloudflare",
			"tunnel_id":  tunnel.ID,
			"account_id": accountID,
		}
		raw["tunnel"] = tunnelCfg
		return nil
	}); err != nil {
		return fmt.Errorf("saving tunnel config: %w", err)
	}

	fmt.Println()
	fmt.Println("Cloudflare Tunnel setup complete.")
	syncStack()
	fmt.Println("When you add apps with cloudflare-tunnel ingress, jib will automatically")
	fmt.Println("create DNS records and tunnel routes.")
	return nil
}

func runCloudflareManualSetup() error {
	fmt.Println()
	fmt.Println("Create a tunnel in the Cloudflare dashboard:")
	fmt.Println("  https://dash.cloudflare.com → Networks → Connectors → Create a tunnel")
	fmt.Println("  When asked, choose 'Cloudflared' (not WARP).")
	fmt.Println()
	fmt.Println("The dashboard will show an install command like:")
	fmt.Println("  sudo cloudflared service install eyJhIjo...")
	fmt.Println("Copy the token (the long eyJ... string at the end).")
	fmt.Println()
	token, err := tui.PromptString("token", "Tunnel token")
	if err != nil {
		return err
	}

	// Save tunnel token and start via stack.
	tunnelTokenPath := filepath.Join(config.JibSecretsDir(), "cloudflare-tunnel-token")
	if err := os.MkdirAll(filepath.Dir(tunnelTokenPath), 0o700); err != nil {
		return fmt.Errorf("creating secrets dir: %w", err)
	}
	if err := os.WriteFile(tunnelTokenPath, []byte(token), 0o600); err != nil {
		return fmt.Errorf("saving tunnel token: %w", err)
	}

	// Save tunnel config (manual mode — no tunnel_id/account_id).
	cfgPath := config.ConfigFile()
	if err := config.ModifyRawConfig(cfgPath, func(raw map[string]interface{}) error {
		raw["tunnel"] = map[string]interface{}{"provider": "cloudflare"}
		return nil
	}); err != nil {
		return fmt.Errorf("saving tunnel config: %w", err)
	}

	fmt.Println("\nCloudflare Tunnel configured.")
	syncStack()
	fmt.Println()
	fmt.Println("Next, go back to the Cloudflare dashboard and:")
	fmt.Println("  1. Click 'Next'")
	fmt.Println("  2. Add a public hostname (your domain AND *.domain)")
	fmt.Println("  3. Set service type to 'HTTP' and URL to 'localhost:80'")
	fmt.Println("  4. Save")
	return nil
}

// cloudflareAPITokenPath returns the path where the Cloudflare API token is stored.
func cloudflareAPITokenPath() string {
	return filepath.Join(config.JibSecretsDir(), "cloudflare-api-token")
}

func runCloudflareStatus(cmd *cobra.Command, args []string) error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	if cfg.Tunnel == nil || cfg.Tunnel.Provider != "cloudflare" {
		fmt.Println("Cloudflare tunnel is not configured.")
		fmt.Println("Run 'jib cloudflare setup' to get started.")
		return nil
	}

	fmt.Println("Cloudflare tunnel: configured")
	if cfg.Tunnel.TunnelID != "" {
		fmt.Printf("  Tunnel ID:  %s\n", cfg.Tunnel.TunnelID)
		fmt.Printf("  Account ID: %s\n", cfg.Tunnel.AccountID)
		fmt.Println("  Mode:       managed (API)")
	} else {
		fmt.Println("  Mode:       manual (dashboard)")
	}

	// Check container status.
	out, err := stack.Status(context.Background())
	if err == nil && strings.Contains(out, "cloudflared") {
		fmt.Println("  Container:  running")
	} else {
		fmt.Println("  Container:  not running")
	}

	return nil
}
