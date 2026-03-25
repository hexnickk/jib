package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"

	"github.com/spf13/cobra"
)

func registerCloudflareCommands(rootCmd *cobra.Command) {
	cfCmd := &cobra.Command{
		Use:   "cloudflare",
		Short: "Manage Cloudflare Tunnel integration",
	}

	cfCmd.AddCommand(&cobra.Command{
		Use:   "setup",
		Short: "Install cloudflared, authenticate, and create a tunnel",
		Args:  cobra.NoArgs,
		RunE:  runCloudflareSetup,
	})

	cfCmd.AddCommand(&cobra.Command{
		Use:   "add <domain>",
		Short: "Route a domain through the Cloudflare Tunnel",
		Args:  exactArgs(1),
		RunE:  runCloudflareAdd,
	})

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
		fmt.Println("cloudflared is not installed.")
		if os.Getuid() != 0 {
			fmt.Println("Run this command as root to install cloudflared automatically, or install it manually:")
			fmt.Println("  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/")
			return fmt.Errorf("cloudflared not installed")
		}
		if err := installCloudflared(); err != nil {
			return fmt.Errorf("installing cloudflared: %w", err)
		}
	} else {
		fmt.Println("cloudflared is already installed.")
	}

	// Step 2: Authenticate (interactive — opens browser)
	fmt.Println()
	fmt.Println("Authenticating with Cloudflare (this will open a browser)...")
	login := exec.Command("cloudflared", "tunnel", "login")
	login.Stdout = os.Stdout
	login.Stderr = os.Stderr
	login.Stdin = os.Stdin
	if err := login.Run(); err != nil {
		return fmt.Errorf("cloudflared login failed: %w", err)
	}

	// Step 3: Create tunnel named "jib"
	fmt.Println()
	fmt.Println("Creating tunnel 'jib'...")
	create := exec.Command("cloudflared", "tunnel", "create", "jib")
	create.Stdout = os.Stdout
	create.Stderr = os.Stderr
	if err := create.Run(); err != nil {
		// Tunnel may already exist — that's fine
		fmt.Println("Note: tunnel creation returned an error (it may already exist).")
		fmt.Println("Run 'cloudflared tunnel list' to check.")
	}

	fmt.Println()
	fmt.Println("Cloudflare Tunnel setup complete.")
	fmt.Println("Add domains with: jib cloudflare add <domain>")
	fmt.Println()
	fmt.Println("To start the tunnel, run:")
	fmt.Println("  cloudflared tunnel run jib")
	fmt.Println()
	fmt.Println("Or install it as a system service:")
	fmt.Println("  cloudflared service install")
	return nil
}

func runCloudflareAdd(cmd *cobra.Command, args []string) error {
	domain := args[0]

	if !cloudflaredInstalled() {
		return fmt.Errorf("cloudflared is not installed — run 'jib cloudflare setup' first")
	}

	fmt.Printf("Routing %s through tunnel 'jib'...\n", domain)
	route := exec.Command("cloudflared", "tunnel", "route", "dns", "jib", domain)
	route.Stdout = os.Stdout
	route.Stderr = os.Stderr
	if err := route.Run(); err != nil {
		return fmt.Errorf("adding DNS route for %s: %w", domain, err)
	}

	fmt.Println()
	fmt.Printf("DNS route added: %s -> tunnel 'jib'\n", domain)
	fmt.Println()
	fmt.Println("Make sure your tunnel config includes an ingress rule for this domain.")
	fmt.Println("Edit ~/.cloudflared/config.yml to add:")
	fmt.Println()
	fmt.Printf("  ingress:\n")
	fmt.Printf("    - hostname: %s\n", domain)
	fmt.Printf("      service: http://localhost:80\n")
	fmt.Printf("    - service: http_status:404\n")
	fmt.Println()
	fmt.Println("Then restart the tunnel: cloudflared tunnel run jib")
	return nil
}

func runCloudflareStatus(cmd *cobra.Command, args []string) error {
	if !cloudflaredInstalled() {
		fmt.Println("cloudflared is not installed.")
		fmt.Println("Run 'jib cloudflare setup' to get started.")
		return nil
	}

	fmt.Println("Cloudflare Tunnel status:")
	fmt.Println()

	// Try to get tunnel info
	info := exec.Command("cloudflared", "tunnel", "info", "jib")
	info.Stdout = os.Stdout
	info.Stderr = os.Stderr
	if err := info.Run(); err != nil {
		// Fall back to listing tunnels
		fmt.Println("Could not get info for tunnel 'jib'. Listing all tunnels:")
		fmt.Println()
		list := exec.Command("cloudflared", "tunnel", "list")
		list.Stdout = os.Stdout
		list.Stderr = os.Stderr
		if listErr := list.Run(); listErr != nil {
			fmt.Println("No tunnels found or not authenticated.")
			fmt.Println("Run 'jib cloudflare setup' to configure.")
		}
	}

	return nil
}
