package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/hexnickk/jib/internal/cloudflare"
	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/tui"
	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
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

// cloudflaredInstalled checks whether cloudflared is on PATH.
func cloudflaredInstalled() bool {
	_, err := exec.LookPath("cloudflared")
	return err == nil
}

func installCloudflared() error {
	if runtime.GOOS != "linux" {
		return fmt.Errorf("automatic install is only supported on Linux — install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/")
	}

	fmt.Println("Installing cloudflared...")

	// Use the official Cloudflare package repository method
	cmds := []*exec.Cmd{
		sudoBash("curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --yes --dearmor -o /usr/share/keyrings/cloudflare-main.gpg"),
		sudoBash(`echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" > /etc/apt/sources.list.d/cloudflared.list`),
		sudoCmd("apt-get", "update", "-qq"),
		sudoCmd("apt-get", "install", "-y", "-qq", "cloudflared"),
	}

	for _, c := range cmds {
		c.Stdout = os.Stdout
		c.Stderr = os.Stderr
		if err := c.Run(); err != nil {
			return fmt.Errorf("running %v: %w", c.Args, err)
		}
	}

	fmt.Println("cloudflared installed successfully.")
	return nil
}

func runCloudflareSetup(cmd *cobra.Command, args []string) error {
	// Step 1: Check / install cloudflared
	if !cloudflaredInstalled() {
		ok, err := tui.PromptConfirm("cloudflared is not installed. Install it now?", true)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("cloudflared is required for Cloudflare Tunnel setup")
		}
		if err := installCloudflared(); err != nil {
			return fmt.Errorf("installing cloudflared: %w", err)
		}
	} else {
		fmt.Println("cloudflared is already installed.")
	}

	// Step 2: Choose setup method
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

	// Install cloudflared service with the token
	fmt.Println("\nInstalling cloudflared service...")
	installSvc := sudoCmd("cloudflared", "service", "install", token)
	installSvc.Stdout = os.Stdout
	installSvc.Stderr = os.Stderr
	if err := installSvc.Run(); err != nil {
		return fmt.Errorf("cloudflared service install failed: %w", err)
	}

	if err := sudoCmd("systemctl", "enable", "--now", "cloudflared").Run(); err != nil {
		fmt.Fprintf(os.Stderr, "warning: systemctl enable cloudflared: %v\n", err)
	}

	// Initialize tunnel with catch-all 404
	_ = client.PutTunnelIngress(ctx, accountID, tunnel.ID, []cloudflare.IngressRule{
		{Service: "http_status:404"},
	})

	// Save tunnel config
	cfgPath := configPath()
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

	// Install as systemd service with the token
	fmt.Println("\nInstalling cloudflared as a system service...")
	installSvc := sudoCmd("cloudflared", "service", "install", token)
	installSvc.Stdout = os.Stdout
	installSvc.Stderr = os.Stderr
	if err := installSvc.Run(); err != nil {
		return fmt.Errorf("cloudflared service install failed: %w", err)
	}

	if err := sudoCmd("systemctl", "enable", "--now", "cloudflared").Run(); err != nil {
		fmt.Fprintf(os.Stderr, "warning: systemctl enable cloudflared: %v\n", err)
	}

	fmt.Println()
	fmt.Println("Cloudflare Tunnel is running as a system service.")
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
	return filepath.Join(jibRoot(), "secrets", "_jib", "cloudflare-api-token")
}

// loadCloudflareAPIToken reads the stored API token.
func loadCloudflareAPIToken() (string, error) {
	data, err := os.ReadFile(cloudflareAPITokenPath()) //nolint:gosec // trusted path
	if err != nil {
		return "", fmt.Errorf("cloudflare API token not found — run 'jib cloudflare setup' with API mode first")
	}
	return strings.TrimSpace(string(data)), nil
}

// loadTunnelConfig reads tunnel_id and account_id from the jib config.
func loadTunnelConfig() (tunnelID, accountID string, err error) {
	cfgPath := configPath()
	data, err := os.ReadFile(cfgPath) //nolint:gosec // trusted config path
	if err != nil {
		return "", "", fmt.Errorf("reading config: %w", err)
	}

	var raw struct {
		Tunnel *struct {
			TunnelID  string `yaml:"tunnel_id"`
			AccountID string `yaml:"account_id"`
		} `yaml:"tunnel"`
	}
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return "", "", fmt.Errorf("parsing config: %w", err)
	}
	if raw.Tunnel == nil || raw.Tunnel.TunnelID == "" {
		return "", "", fmt.Errorf("no tunnel configured — run 'jib cloudflare setup' first")
	}
	return raw.Tunnel.TunnelID, raw.Tunnel.AccountID, nil
}

// addCloudflareRoutes creates DNS records and tunnel ingress rules for the given domains.
func addCloudflareRoutes(ctx context.Context, domains []string) error {
	token, err := loadCloudflareAPIToken()
	if err != nil {
		return err
	}
	tunnelID, accountID, err := loadTunnelConfig()
	if err != nil {
		return err
	}

	client := cloudflare.NewClient(token)
	return client.AddTunnelRoutes(ctx, accountID, tunnelID, domains)
}

// removeCloudflareRoutes removes DNS records and tunnel ingress rules for the given domains.
func removeCloudflareRoutes(ctx context.Context, domains []string) error {
	token, err := loadCloudflareAPIToken()
	if err != nil {
		return err
	}
	tunnelID, accountID, err := loadTunnelConfig()
	if err != nil {
		return err
	}

	client := cloudflare.NewClient(token)
	return client.RemoveTunnelRoutes(ctx, accountID, tunnelID, domains)
}

func runCloudflareStatus(cmd *cobra.Command, args []string) error {
	if !cloudflaredInstalled() {
		fmt.Println("cloudflared is not installed.")
		fmt.Println("Run 'jib cloudflare setup' to get started.")
		return nil
	}

	// Check systemd service status (no sudo needed for viewing)
	status := exec.Command("systemctl", "status", "cloudflared", "--no-pager") //nolint:gosec // trusted CLI subprocess
	status.Stdout = os.Stdout
	status.Stderr = os.Stderr
	if err := status.Run(); err != nil {
		fmt.Println("\ncloudflared service is not running.")
		fmt.Println("Run 'jib cloudflare setup' to configure.")
	}

	return nil
}
