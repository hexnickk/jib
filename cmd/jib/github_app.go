package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	ghPkg "github.com/hexnickk/jib/internal/github"
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
	setupCmd.Flags().Int64("app-id", 0, "GitHub App ID (required)")
	setupCmd.Flags().String("private-key", "", "Path to PEM file, or - to read from stdin (required)")
	_ = setupCmd.MarkFlagRequired("app-id")
	_ = setupCmd.MarkFlagRequired("private-key")
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
	root := jibRoot()
	appID, _ := cmd.Flags().GetInt64("app-id")
	keyFile, _ := cmd.Flags().GetString("private-key")

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	if err := ghPkg.ProviderNameAvailable(cfg, name); err != nil {
		return err
	}

	// Read PEM from file or stdin (--private-key -)
	var src io.Reader
	if keyFile == "-" {
		fmt.Println("Paste the private key PEM, then press Ctrl+D:")
		src = os.Stdin
	} else {
		f, err := os.Open(keyFile)
		if err != nil {
			return fmt.Errorf("opening private key file: %w", err)
		}
		defer f.Close()
		src = f
	}

	pemPath := ghPkg.AppPEMPath(root, name)
	if err := os.MkdirAll(filepath.Dir(pemPath), 0o700); err != nil {
		return fmt.Errorf("creating secrets directory: %w", err)
	}

	dst, err := os.OpenFile(pemPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("creating PEM file: %w", err)
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
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
	fmt.Printf("\nUse it with: jib add <app> --repo <org/repo> --domain <domain> --git-provider %s\n", name)
	return nil
}

func runGitHubAppStatus(cmd *cobra.Command, args []string) error {
	name := args[0]
	root := jibRoot()

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

	pemPath := ghPkg.AppPEMPath(root, name)
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
	root := jibRoot()

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
	pemPath := ghPkg.AppPEMPath(root, name)
	_ = os.Remove(pemPath)

	// Remove from config
	if err := removeProvider(name); err != nil {
		return fmt.Errorf("updating config: %w", err)
	}

	fmt.Printf("Removed provider %q.\n", name)
	return nil
}
