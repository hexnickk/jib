package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/network"
	"github.com/spf13/cobra"
)

func registerGitHubCommands(rootCmd *cobra.Command) {
	githubCmd := &cobra.Command{
		Use:   "github",
		Short: "Manage GitHub integration (keys, apps, webhooks)",
	}

	registerGitHubKeyCommands(githubCmd)
	registerGitHubAppCommands(githubCmd)
	registerGitHubWebhookCommands(githubCmd)

	rootCmd.AddCommand(githubCmd)
}

func registerGitHubWebhookCommands(githubCmd *cobra.Command) {
	webhookCmd := &cobra.Command{
		Use:   "webhook",
		Short: "Manage GitHub webhooks for push-based deploys",
	}

	webhookCmd.AddCommand(&cobra.Command{
		Use:   "setup <app>",
		Short: "Set up GitHub webhook for an app",
		Args:  exactArgs(1),
		RunE:  runGitHubWebhookSetup,
	})

	webhookCmd.AddCommand(&cobra.Command{
		Use:   "status <app>",
		Short: "Show webhook status for an app",
		Args:  exactArgs(1),
		RunE:  runGitHubWebhookStatus,
	})

	webhookCmd.AddCommand(&cobra.Command{
		Use:   "remove <app>",
		Short: "Remove webhook for an app",
		Args:  exactArgs(1),
		RunE:  runGitHubWebhookRemove,
	})

	githubCmd.AddCommand(webhookCmd)
}

// webhookURL builds the webhook callback URL for an app.
func webhookURL(cfg *config.Config, appName string) string {
	serverIP := network.GetPublicIP()
	if serverIP == "" {
		serverIP = "<server-public-ip>"
	}
	port := 9090
	if cfg.Webhook != nil && cfg.Webhook.Port > 0 {
		port = cfg.Webhook.Port
	}
	return fmt.Sprintf("http://%s:%d/_jib/webhook/%s", serverIP, port, appName)
}

func runGitHubWebhookSetup(cmd *cobra.Command, args []string) error {
	appName := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}
	if _, err := requireApp(cfg, appName); err != nil {
		return err
	}

	root := jibRoot()
	secretsDir := filepath.Join(root, "secrets", "_jib")
	if err := os.MkdirAll(secretsDir, 0o700); err != nil {
		return fmt.Errorf("creating secrets directory: %w", err)
	}

	// Generate or load webhook secret
	webhookSecretPath := filepath.Join(secretsDir, appName+"-github-webhook.json")
	var webhookSecret string

	if data, err := os.ReadFile(webhookSecretPath); err == nil { //nolint:gosec // path from trusted config
		var secretData map[string]string
		if err := json.Unmarshal(data, &secretData); err == nil {
			webhookSecret = secretData["secret"]
			fmt.Println("Webhook secret already exists.")
		}
	}

	if webhookSecret == "" {
		secretBytes := make([]byte, 32)
		if _, err := rand.Read(secretBytes); err != nil {
			return fmt.Errorf("generating webhook secret: %w", err)
		}
		webhookSecret = hex.EncodeToString(secretBytes)

		secretData := map[string]string{"secret": webhookSecret}
		jsonData, err := json.MarshalIndent(secretData, "", "  ")
		if err != nil {
			return fmt.Errorf("marshaling webhook secret: %w", err)
		}
		if err := os.WriteFile(webhookSecretPath, jsonData, 0o600); err != nil {
			return fmt.Errorf("writing webhook secret: %w", err)
		}
		fmt.Printf("Webhook secret stored at %s\n", webhookSecretPath)
	}

	url := webhookURL(cfg, appName)

	fmt.Println()
	fmt.Println("=== Webhook Configuration ===")
	fmt.Printf("URL:    %s\n", url)
	fmt.Printf("Secret: %s\n", webhookSecret)
	fmt.Println()
	fmt.Println("Add this webhook to your GitHub repo:")
	fmt.Println("  Repository -> Settings -> Webhooks -> Add webhook")
	fmt.Printf("  Payload URL: %s\n", url)
	fmt.Println("  Content type: application/json")
	fmt.Printf("  Secret: %s\n", webhookSecret)
	fmt.Println("  Events: Just the push event")
	fmt.Println()

	// Store webhook config in app config
	if err := modifyAppWebhookConfig(appName, func(appMap map[string]interface{}) {
		appMap["webhook"] = map[string]interface{}{
			"provider": "github",
		}
	}); err != nil {
		return fmt.Errorf("updating config: %w", err)
	}

	fmt.Printf("Webhook configured for %q.\n", appName)
	return nil
}

func runGitHubWebhookStatus(cmd *cobra.Command, args []string) error {
	appName := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}
	if _, err := requireApp(cfg, appName); err != nil {
		return err
	}

	root := jibRoot()
	webhookSecretPath := filepath.Join(root, "secrets", "_jib", appName+"-github-webhook.json")

	fmt.Printf("Webhook status for %q:\n\n", appName)

	if data, err := os.ReadFile(webhookSecretPath); err == nil { //nolint:gosec // path from trusted config
		var secretData map[string]string
		if err := json.Unmarshal(data, &secretData); err == nil {
			secret := secretData["secret"]
			if len(secret) > 8 {
				fmt.Printf("  Secret: %s...%s\n", secret[:4], secret[len(secret)-4:])
			} else {
				fmt.Println("  Secret: configured")
			}
		}
	} else {
		fmt.Println("  Secret: not configured")
	}

	fmt.Printf("  URL: %s\n", webhookURL(cfg, appName))

	appCfg := cfg.Apps[appName]
	if appCfg.Webhook != nil {
		fmt.Printf("  Config: provider=%s\n", appCfg.Webhook.Provider)
	} else {
		fmt.Println("  Config: not set")
	}

	return nil
}

func runGitHubWebhookRemove(cmd *cobra.Command, args []string) error {
	appName := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}
	if _, err := requireApp(cfg, appName); err != nil {
		return err
	}

	root := jibRoot()
	webhookSecretPath := filepath.Join(root, "secrets", "_jib", appName+"-github-webhook.json")

	var removed []string

	if err := os.Remove(webhookSecretPath); err != nil && !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "warning: removing webhook secret: %v\n", err)
	} else if err == nil {
		removed = append(removed, "webhook secret")
	}

	appCfg := cfg.Apps[appName]
	if appCfg.Webhook != nil {
		if err := modifyAppWebhookConfig(appName, func(appMap map[string]interface{}) {
			delete(appMap, "webhook")
		}); err != nil {
			fmt.Fprintf(os.Stderr, "warning: updating config: %v\n", err)
		} else {
			removed = append(removed, "config")
		}
	}

	if len(removed) == 0 {
		fmt.Printf("No webhook found for %q.\n", appName)
	} else {
		fmt.Printf("Removed webhook for %q: %s\n", appName, strings.Join(removed, ", "))
	}

	return nil
}

// modifyAppWebhookConfig loads the raw YAML config, navigates to the named
// app entry, calls mutate to modify it, then writes the result back.
func modifyAppWebhookConfig(appName string, mutate func(appMap map[string]interface{})) error {
	cfgPath := configPath()
	return config.ModifyRawConfig(cfgPath, func(raw map[string]interface{}) error {
		appsRaw, ok := raw["apps"]
		if !ok {
			return fmt.Errorf("no apps section in config")
		}
		appsMap, ok := appsRaw.(map[string]interface{})
		if !ok {
			return fmt.Errorf("apps section is not a map")
		}
		appRaw, ok := appsMap[appName]
		if !ok {
			return fmt.Errorf("app %q not found in config", appName)
		}
		appMap, ok := appRaw.(map[string]interface{})
		if !ok {
			return fmt.Errorf("app %q config is not a map", appName)
		}

		mutate(appMap)
		return nil
	})
}
