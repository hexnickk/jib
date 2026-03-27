package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"

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

// tailscaleInstalled checks whether the tailscale CLI is on PATH.
func tailscaleInstalled() bool {
	_, err := exec.LookPath("tailscale")
	return err == nil
}

func installTailscale() error {
	if runtime.GOOS != "linux" {
		return fmt.Errorf("automatic install is only supported on Linux — install Tailscale manually: https://tailscale.com/download")
	}

	fmt.Println("Installing Tailscale...")
	install := exec.Command("bash", "-c", "curl -fsSL https://tailscale.com/install.sh | sh") //nolint:gosec // trusted CLI subprocess
	install.Stdout = os.Stdout
	install.Stderr = os.Stderr
	if err := install.Run(); err != nil {
		return fmt.Errorf("tailscale install script failed: %w", err)
	}

	fmt.Println("Tailscale installed successfully.")
	return nil
}

func runTailscaleSetup(cmd *cobra.Command, args []string) error {
	fmt.Println("Set up Tailscale for private networking and HTTPS.")
	fmt.Println()
	fmt.Println("This will:")
	fmt.Println("  1. Install Tailscale (if needed)")
	fmt.Println("  2. Connect this server to your Tailnet")
	fmt.Println("  3. Enable access to your apps via Tailscale IPs/MagicDNS")
	fmt.Println()
	fmt.Println("You'll need a Tailscale account — sign up at https://tailscale.com")
	fmt.Println()

	// Step 1: Check / install tailscale
	if !tailscaleInstalled() {
		ok, err := tui.PromptConfirm("Tailscale is not installed. Install it now?", true)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("tailscale is required for Tailscale setup")
		}
		if err := installTailscale(); err != nil {
			return fmt.Errorf("installing tailscale: %w", err)
		}
	} else {
		fmt.Println("Tailscale is already installed.")
	}

	// Step 2: Bring Tailscale up (interactive — may require auth URL)
	fmt.Println()
	fmt.Println("Connecting to Tailscale network...")
	up := exec.Command("tailscale", "up") //nolint:gosec // trusted CLI subprocess
	up.Stdout = os.Stdout
	up.Stderr = os.Stderr
	up.Stdin = os.Stdin
	if err := up.Run(); err != nil {
		return fmt.Errorf("tailscale up failed: %w", err)
	}

	// Step 3: Display IP and hostname
	fmt.Println()
	printTailscaleInfo()

	fmt.Println()
	fmt.Println("Tailscale setup complete.")
	fmt.Println("Your server is now accessible over your Tailscale network.")
	fmt.Println()
	fmt.Println("For HTTPS certificates via Tailscale, run:")
	fmt.Println("  tailscale cert <your-machine-name>.<tailnet>.ts.net")
	return nil
}

func runTailscaleStatus(cmd *cobra.Command, args []string) error {
	if !tailscaleInstalled() {
		fmt.Println("Tailscale is not installed.")
		fmt.Println("Run 'jib tailscale setup' to get started.")
		return nil
	}

	fmt.Println("Tailscale status:")
	fmt.Println()

	status := exec.Command("tailscale", "status") //nolint:gosec // trusted CLI subprocess
	status.Stdout = os.Stdout
	status.Stderr = os.Stderr
	if err := status.Run(); err != nil {
		fmt.Println("Tailscale is not connected or not running.")
		fmt.Println("Run 'jib tailscale setup' to connect.")
	}

	fmt.Println()
	printTailscaleInfo()

	return nil
}

// printTailscaleInfo prints the Tailscale IP and hostname if available.
func printTailscaleInfo() {
	// Get Tailscale IP
	ipCmd := exec.Command("tailscale", "ip", "-4") //nolint:gosec // trusted CLI subprocess
	ipOut, err := ipCmd.Output()
	if err == nil {
		ip := strings.TrimSpace(string(ipOut))
		if ip != "" {
			fmt.Printf("Tailscale IPv4: %s\n", ip)
		}
	}

	// Get MagicDNS hostname from the Self section of tailscale status JSON.
	statusCmd := exec.Command("tailscale", "status", "--json") //nolint:gosec // trusted CLI subprocess
	statusOut, err := statusCmd.Output()
	if err == nil {
		var status struct {
			Self struct {
				DNSName string `json:"DNSName"`
			} `json:"Self"`
		}
		if json.Unmarshal(statusOut, &status) == nil && status.Self.DNSName != "" {
			fmt.Printf("MagicDNS:      %s\n", strings.TrimSuffix(status.Self.DNSName, "."))
		}
	}
}
