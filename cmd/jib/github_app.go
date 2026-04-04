package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	ghPkg "github.com/hexnickk/jib/internal/github"
	"github.com/hexnickk/jib/internal/tui"
	"github.com/spf13/cobra"
)

func registerGitHubAppCommands(githubCmd *cobra.Command) {
	appCmd := &cobra.Command{
		Use:   "app",
		Short: "Manage GitHub App providers",
	}

	setupCmd := &cobra.Command{
		Use:   "setup <name>",
		Short: "Register a GitHub App provider",
		Args:  exactArgs(1),
		RunE:  runGitHubAppSetup,
	}
	setupCmd.Flags().Int64("app-id", 0, "GitHub App ID")
	setupCmd.Flags().String("private-key", "", "Path to PEM file, or - to read from stdin")
	appCmd.AddCommand(setupCmd)

	appCmd.AddCommand(&cobra.Command{
		Use:   "status <name>",
		Short: "Show GitHub App provider status",
		Args:  exactArgs(1),
		RunE:  runGitHubAppStatus,
	})

	appCmd.AddCommand(&cobra.Command{
		Use:   "remove <name>",
		Short: "Remove a GitHub App provider",
		Args:  exactArgs(1),
		RunE:  runGitHubAppRemove,
	})

	githubCmd.AddCommand(appCmd)
}

func runGitHubAppSetup(cmd *cobra.Command, args []string) error {
	name := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	if err := providerNameAvailable(cfg, name); err != nil {
		return err
	}

	// Show setup guide when running interactively without flags.
	appID, _ := cmd.Flags().GetInt64("app-id")
	keyFile, _ := cmd.Flags().GetString("private-key")

	if appID == 0 && keyFile == "" && tui.IsInteractive() {
		method, err := tui.PromptSelect("How would you like to create the GitHub App?", []tui.SelectOption{
			{Label: "Automatic (recommended) — creates the app in your browser", Value: "manifest"},
			{Label: "Manual — you create the app and paste credentials", Value: "manual"},
		})
		if err != nil {
			return err
		}

		if method == "manifest" {
			return runGitHubAppManifest(name)
		}

		// Manual flow — show guide
		fmt.Println()
		fmt.Println("You'll need:")
		fmt.Println("  1. A GitHub App — create one at https://github.com/settings/apps/new")
		fmt.Println("     - Set Homepage URL to any valid URL")
		fmt.Println("     - Under Repository permissions, set Contents to Read-only")
		fmt.Println("     - Disable webhooks (uncheck Active)")
		fmt.Println("  2. The App ID — shown on the app's settings page after creation")
		fmt.Println("  3. A private key — generate one under the app's settings → Private keys")
		fmt.Println()
	}

	// Resolve app-id (flag or interactive prompt)
	if appID == 0 {
		appID, err = tui.PromptInt64("app-id", "GitHub App ID")
		if err != nil {
			return err
		}
	}

	// Resolve private key (flag, stdin, or interactive prompt)
	var src io.Reader
	if keyFile == "-" {
		fmt.Println("Paste the private key PEM, then press Ctrl+D:")
		src = os.Stdin
	} else if keyFile != "" {
		f, err := os.Open(keyFile) //nolint:gosec // CLI reads user-specified key file
		if err != nil {
			return fmt.Errorf("opening private key file: %w", err)
		}
		defer func() { _ = f.Close() }()
		src = f
	} else {
		// No flag provided — prompt interactively (auto-detects END marker)
		pemData, err := tui.PromptPEM("private-key", "Paste the private key PEM")
		if err != nil {
			return err
		}
		src = strings.NewReader(pemData)
	}

	return saveGitHubAppProvider(name, appID, "", src)
}

// runGitHubAppManifest handles the automatic GitHub App creation via manifest flow.
func runGitHubAppManifest(name string) error {
	ctx := context.Background()
	result, err := runManifestFlow(ctx, name)
	if err != nil {
		return fmt.Errorf("manifest flow: %w", err)
	}

	fmt.Printf("\nGitHub App %q created (ID: %d).\n", result.Slug, result.AppID)

	return saveGitHubAppProvider(name, result.AppID, result.Slug, strings.NewReader(result.PEM))
}

// saveGitHubAppProvider saves the app ID to config and the PEM key to disk.
// slug is the GitHub App slug (used for the installation URL); empty for manual flow.
func saveGitHubAppProvider(name string, appID int64, slug string, pemSrc io.Reader) error {
	pemPath := ghPkg.AppPEMPath(name)
	if err := os.MkdirAll(filepath.Dir(pemPath), 0o700); err != nil {
		return fmt.Errorf("creating secrets directory: %w", err)
	}

	dst, err := os.OpenFile(pemPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600) //nolint:gosec // path from trusted config
	if err != nil {
		return fmt.Errorf("creating PEM file: %w", err)
	}
	if _, err := io.Copy(dst, pemSrc); err != nil {
		_ = dst.Close()
		return fmt.Errorf("copying PEM file: %w", err)
	}
	if err := dst.Close(); err != nil {
		return fmt.Errorf("writing PEM file: %w", err)
	}

	// Save provider to config
	if err := saveProvider(name, map[string]interface{}{
		"type":   "app",
		"app_id": appID,
	}); err != nil {
		return fmt.Errorf("saving provider to config: %w", err)
	}

	fmt.Printf("Provider %q (GitHub App, app_id=%d) created.\n", name, appID)
	fmt.Printf("Private key stored at %s\n", pemPath)
	fmt.Println()
	fmt.Println("Next: install the app on your GitHub org/repo:")
	if slug == "" {
		slug = name // best guess for manual flow
	}
	fmt.Printf("  https://github.com/settings/apps/%s/installations\n", slug)
	fmt.Printf("\nThen use it with: jib add <app> --repo <org/repo> --domain <domain> --git-provider %s\n", name)
	return nil
}

func runGitHubAppStatus(cmd *cobra.Command, args []string) error {
	name := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	provider, ok := cfg.LookupProvider(name)
	if !ok {
		return fmt.Errorf("provider %q not found", name)
	}
	if provider.Type != ghPkg.ProviderTypeApp {
		return fmt.Errorf("provider %q is type %q, not a GitHub App", name, provider.Type)
	}

	fmt.Printf("Provider %q (GitHub App):\n\n", name)
	fmt.Printf("  App ID: %d\n", provider.AppID)

	pemPath := ghPkg.AppPEMPath(name)
	if _, err := os.Stat(pemPath); err == nil {
		fmt.Printf("  Private key: %s\n", pemPath)
	} else {
		fmt.Println("  Private key: file missing!")
	}

	apps := appsUsingProvider(cfg, name)
	if len(apps) > 0 {
		fmt.Printf("  Used by: %s\n", strings.Join(apps, ", "))
	} else {
		fmt.Println("  Used by: (none)")
	}

	return nil
}

func runGitHubAppRemove(cmd *cobra.Command, args []string) error {
	name := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	provider, ok := cfg.LookupProvider(name)
	if !ok {
		return fmt.Errorf("provider %q not found", name)
	}
	if provider.Type != ghPkg.ProviderTypeApp {
		return fmt.Errorf("provider %q is type %q, not a GitHub App", name, provider.Type)
	}

	// Check no apps reference this provider
	for appName, app := range cfg.Apps {
		if app.Provider == name {
			return fmt.Errorf("cannot remove provider %q: still used by app %q", name, appName)
		}
	}

	// Remove PEM file
	pemPath := ghPkg.AppPEMPath(name)
	_ = os.Remove(pemPath)

	// Remove from config
	if err := removeProvider(name); err != nil {
		return fmt.Errorf("updating config: %w", err)
	}

	fmt.Printf("Removed provider %q.\n", name)
	return nil
}
