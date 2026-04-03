package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/hexnickk/jib/internal/config"
	ghPkg "github.com/hexnickk/jib/internal/github"
	"github.com/hexnickk/jib/internal/tui"
	"github.com/spf13/cobra"
)

func registerGitHubKeyCommands(githubCmd *cobra.Command) {
	keyCmd := &cobra.Command{
		Use:   "key",
		Short: "Manage SSH deploy key providers",
	}

	keyCmd.AddCommand(&cobra.Command{
		Use:   "setup <name>",
		Short: "Generate an SSH deploy key provider",
		Args:  exactArgs(1),
		RunE:  runGitHubKeySetup,
	})

	keyCmd.AddCommand(&cobra.Command{
		Use:   "status <name>",
		Short: "Show deploy key fingerprint and usage",
		Args:  exactArgs(1),
		RunE:  runGitHubKeyStatus,
	})

	keyCmd.AddCommand(&cobra.Command{
		Use:   "remove <name>",
		Short: "Remove a deploy key provider",
		Args:  exactArgs(1),
		RunE:  runGitHubKeyRemove,
	})

	githubCmd.AddCommand(keyCmd)
}

func runGitHubKeySetup(cmd *cobra.Command, args []string) error {
	name := args[0]
	root := config.Root()

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	if err := ghPkg.ProviderNameAvailable(cfg, name); err != nil {
		return err
	}

	// Check if key already exists on disk
	keyPath := ghPkg.KeyPath(root, name)
	if _, err := os.Stat(keyPath); err == nil {
		return fmt.Errorf("deploy key already exists at %s — remove it first with 'jib github key remove %s'", keyPath, name)
	}

	fmt.Println("Generating SSH deploy key...")
	pubKey, err := ghPkg.GenerateDeployKey(root, name)
	if err != nil {
		return err
	}

	fmt.Println()
	fmt.Println("=== Deploy Key (public) ===")
	fmt.Println(strings.TrimSpace(pubKey))
	fmt.Println()
	fmt.Println("Add this key to your GitHub repository:")
	fmt.Println("  1. Go to https://github.com/<org>/<repo>/settings/keys")
	fmt.Println("  2. Click 'Add deploy key'")
	fmt.Println("  3. Title: jib-deploy-" + name)
	fmt.Println("  4. Paste the key above")
	fmt.Println("  5. Leave 'Allow write access' unchecked")
	fmt.Println()
	if err := tui.PromptContinue("Press Enter after adding the key"); err != nil {
		return err
	}

	// Save provider to config
	if err := saveProvider(name, map[string]interface{}{
		"type": "key",
	}); err != nil {
		return fmt.Errorf("saving provider to config: %w", err)
	}

	fmt.Printf("\nProvider %q (deploy key) created.\n", name)
	fmt.Printf("Use it with: jib add <app> --repo <org/repo> --domain <domain> --git-provider %s\n", name)
	return nil
}

func runGitHubKeyStatus(cmd *cobra.Command, args []string) error {
	name := args[0]
	root := config.Root()

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	provider, ok := cfg.LookupProvider(name)
	if !ok {
		return fmt.Errorf("provider %q not found", name)
	}
	if provider.Type != ghPkg.ProviderTypeKey {
		return fmt.Errorf("provider %q is type %q, not a deploy key", name, provider.Type)
	}

	fmt.Printf("Provider %q (deploy key):\n\n", name)

	keyPath := ghPkg.KeyPath(root, name)
	if _, err := os.Stat(keyPath); err == nil {
		fingerprintCmd := exec.Command("ssh-keygen", "-l", "-f", keyPath) //nolint:gosec // trusted CLI subprocess
		output, err := fingerprintCmd.Output()
		if err != nil {
			fmt.Printf("  Key: %s (could not read fingerprint)\n", keyPath)
		} else {
			fmt.Printf("  Key: %s\n", strings.TrimSpace(string(output)))
		}
	} else {
		fmt.Println("  Key: file missing!")
	}

	// List apps using this provider
	apps := appsUsingProvider(cfg, name)
	if len(apps) > 0 {
		fmt.Printf("  Used by: %s\n", strings.Join(apps, ", "))
	} else {
		fmt.Println("  Used by: (none)")
	}

	return nil
}

func runGitHubKeyRemove(cmd *cobra.Command, args []string) error {
	name := args[0]
	root := config.Root()

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	provider, ok := cfg.LookupProvider(name)
	if !ok {
		return fmt.Errorf("provider %q not found", name)
	}
	if provider.Type != ghPkg.ProviderTypeKey {
		return fmt.Errorf("provider %q is type %q, not a deploy key", name, provider.Type)
	}

	// Check no apps reference this provider
	for appName, app := range cfg.Apps {
		if app.Provider == name {
			return fmt.Errorf("cannot remove provider %q: still used by app %q", name, appName)
		}
	}

	// Remove key files
	keyPath := ghPkg.KeyPath(root, name)
	_ = os.Remove(keyPath)
	_ = os.Remove(keyPath + ".pub")

	// Remove from config
	if err := removeProvider(name); err != nil {
		return fmt.Errorf("updating config: %w", err)
	}

	fmt.Printf("Removed provider %q.\n", name)
	fmt.Println("Remember to also remove the deploy key from your GitHub repository settings.")
	return nil
}

// appsUsingProvider returns the names of apps referencing a given provider.
func appsUsingProvider(cfg *config.Config, providerName string) []string {
	var apps []string
	for name, app := range cfg.Apps {
		if app.Provider == providerName {
			apps = append(apps, name)
		}
	}
	return apps
}

// saveProvider adds a provider entry to the config YAML.
func saveProvider(name string, data map[string]interface{}) error {
	return config.ModifyRawConfig(config.ConfigFile(), func(raw map[string]interface{}) error {
		gh, ok := raw["github"].(map[string]interface{})
		if !ok {
			gh = make(map[string]interface{})
			raw["github"] = gh
		}
		providers, ok := gh["providers"].(map[string]interface{})
		if !ok {
			providers = make(map[string]interface{})
			gh["providers"] = providers
		}
		providers[name] = data
		return nil
	})
}

// removeProvider removes a provider entry from the config YAML.
func removeProvider(name string) error {
	return config.ModifyRawConfig(config.ConfigFile(), func(raw map[string]interface{}) error {
		gh, ok := raw["github"].(map[string]interface{})
		if !ok {
			return nil
		}
		providers, ok := gh["providers"].(map[string]interface{})
		if !ok {
			return nil
		}
		delete(providers, name)
		if len(providers) == 0 {
			delete(gh, "providers")
		}
		if len(gh) == 0 {
			delete(raw, "github")
		}
		return nil
	})
}
