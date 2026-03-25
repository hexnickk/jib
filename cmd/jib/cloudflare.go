package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/spf13/cobra"
)

func registerCloudflareCommands(rootCmd *cobra.Command) {
	cfCmd := &cobra.Command{
		Use:   "cloudflare",
		Short: "Manage Cloudflare Tunnel integration",
	}

	cfCmd.AddCommand(&cobra.Command{
		Use:   "setup",
		Short: "Install cloudflared and connect a dashboard-managed tunnel",
		Args:  cobra.NoArgs,
		RunE:  runCloudflareSetup,
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
	reader := bufio.NewReader(os.Stdin)

	// Step 1: Check / install cloudflared
	if !cloudflaredInstalled() {
		fmt.Print("cloudflared is not installed. Install it now? [Y/n]: ")
		answer, _ := reader.ReadString('\n')
		answer = strings.TrimSpace(strings.ToLower(answer))
		if answer != "" && answer != "y" && answer != "yes" {
			return fmt.Errorf("cloudflared is required for Cloudflare Tunnel setup")
		}
		if err := installCloudflared(); err != nil {
			return fmt.Errorf("installing cloudflared: %w", err)
		}
	} else {
		fmt.Println("cloudflared is already installed.")
	}

	// Step 2: Get tunnel token from user (dashboard-managed tunnel)
	fmt.Println()
	fmt.Println("Create a tunnel in the Cloudflare dashboard:")
	fmt.Println("  https://dash.cloudflare.com → Networks → Connectors → Create a tunnel")
	fmt.Println()
	fmt.Print("Paste the tunnel token: ")
	token, _ := reader.ReadString('\n')
	token = strings.TrimSpace(token)
	if token == "" {
		return fmt.Errorf("tunnel token is required")
	}

	// Step 3: Install as systemd service with the token
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
	fmt.Println("Manage routes and ingress rules from the Zero Trust dashboard.")
	return nil
}

func runCloudflareStatus(cmd *cobra.Command, args []string) error {
	if !cloudflaredInstalled() {
		fmt.Println("cloudflared is not installed.")
		fmt.Println("Run 'jib cloudflare setup' to get started.")
		return nil
	}

	// Check systemd service status (no sudo needed for viewing)
	status := exec.Command("systemctl", "status", "cloudflared", "--no-pager")
	status.Stdout = os.Stdout
	status.Stderr = os.Stderr
	if err := status.Run(); err != nil {
		fmt.Println("\ncloudflared service is not running.")
		fmt.Println("Run 'jib cloudflare setup' to configure.")
	}

	return nil
}
