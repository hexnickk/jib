package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/network"
	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

func registerGitHubCommands(rootCmd *cobra.Command) {
	githubCmd := &cobra.Command{
		Use:   "github",
		Short: "Manage GitHub integration (deploy keys, webhooks)",
	}

	githubCmd.AddCommand(&cobra.Command{
		Use:   "setup <app>",
		Short: "Set up GitHub deploy key and webhook for an app",
		Args:  cobra.ExactArgs(1),
		RunE:  runGitHubSetup,
	})

	githubCmd.AddCommand(&cobra.Command{
		Use:   "status <app>",
		Short: "Show deploy key fingerprint and webhook info",
		Args:  cobra.ExactArgs(1),
		RunE:  runGitHubStatus,
	})

	githubCmd.AddCommand(&cobra.Command{
		Use:   "remove <app>",
		Short: "Remove deploy key and webhook secret for an app",
		Args:  cobra.ExactArgs(1),
		RunE:  runGitHubRemove,
	})

	rootCmd.AddCommand(githubCmd)
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

func runGitHubSetup(cmd *cobra.Command, args []string) error {
	appName := args[0]

	// Verify app exists in config
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}
	if _, ok := cfg.Apps[appName]; !ok {
		return fmt.Errorf("app %q not found in config", appName)
	}

	root := jibRoot()
	deployKeyDir := filepath.Join(root, "deploy-keys")
	secretsDir := filepath.Join(root, "secrets", "_jib")

	// Ensure directories exist
	if err := os.MkdirAll(deployKeyDir, 0o700); err != nil {
		return fmt.Errorf("creating deploy-keys directory: %w", err)
	}
	if err := os.MkdirAll(secretsDir, 0o700); err != nil {
		return fmt.Errorf("creating secrets directory: %w", err)
	}

	keyPath := filepath.Join(deployKeyDir, appName)

	// Step 1: Generate SSH deploy key
	if _, err := os.Stat(keyPath); err == nil {
		fmt.Printf("Deploy key already exists at %s\n", keyPath)
		fmt.Println("To regenerate, run 'jib github remove' first.")
	} else {
		fmt.Println("Generating SSH deploy key...")
		keygen := exec.Command("ssh-keygen", "-t", "ed25519",
			"-f", keyPath,
			"-N", "",
			"-C", fmt.Sprintf("jib-deploy-%s", appName),
		)
		keygen.Stdout = os.Stdout
		keygen.Stderr = os.Stderr
		if err := keygen.Run(); err != nil {
			return fmt.Errorf("ssh-keygen failed: %w", err)
		}
		// Lock down permissions on the private key
		if err := os.Chmod(keyPath, 0o600); err != nil {
			return fmt.Errorf("setting deploy key permissions: %w", err)
		}
		fmt.Printf("Deploy key generated: %s\n", keyPath)
	}

	// Print the public key
	pubKeyData, err := os.ReadFile(keyPath + ".pub")
	if err != nil {
		return fmt.Errorf("reading public key: %w", err)
	}
	fmt.Println()
	fmt.Println("=== Deploy Key (public) ===")
	fmt.Println(strings.TrimSpace(string(pubKeyData)))
	fmt.Println()
	fmt.Println("Add this key to your GitHub repo:")
	fmt.Println("  Repository -> Settings -> Deploy keys -> Add deploy key")
	fmt.Println("  Title: jib-deploy-" + appName)
	fmt.Println("  Allow write access: No (read-only is fine)")
	fmt.Println()

	// Step 2: Generate webhook secret
	webhookSecretPath := filepath.Join(secretsDir, appName+"-github-webhook.json")
	var webhookSecret string

	if data, err := os.ReadFile(webhookSecretPath); err == nil {
		// Secret already exists, read it
		var secretData map[string]string
		if err := json.Unmarshal(data, &secretData); err == nil {
			webhookSecret = secretData["secret"]
			fmt.Println("Webhook secret already exists.")
		}
	}

	if webhookSecret == "" {
		// Generate new 32-byte hex secret
		secretBytes := make([]byte, 32)
		if _, err := rand.Read(secretBytes); err != nil {
			return fmt.Errorf("generating webhook secret: %w", err)
		}
		webhookSecret = hex.EncodeToString(secretBytes)

		secretData := map[string]string{
			"secret": webhookSecret,
		}
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

	// Step 3: Store webhook config in app config
	if err := modifyAppWebhookConfig(appName, func(appMap map[string]interface{}) {
		appMap["webhook"] = map[string]interface{}{
			"provider": "github",
		}
	}); err != nil {
		return fmt.Errorf("updating config: %w", err)
	}

	fmt.Printf("GitHub integration configured for %q.\n", appName)
	return nil
}

func runGitHubStatus(cmd *cobra.Command, args []string) error {
	appName := args[0]

	// Verify app exists
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}
	if _, ok := cfg.Apps[appName]; !ok {
		return fmt.Errorf("app %q not found in config", appName)
	}

	root := jibRoot()
	keyPath := filepath.Join(root, "deploy-keys", appName)
	webhookSecretPath := filepath.Join(root, "secrets", "_jib", appName+"-github-webhook.json")

	fmt.Printf("GitHub integration status for %q:\n\n", appName)

	// Deploy key
	if _, err := os.Stat(keyPath); err == nil {
		// Get fingerprint
		fingerprintCmd := exec.Command("ssh-keygen", "-l", "-f", keyPath)
		output, err := fingerprintCmd.Output()
		if err != nil {
			fmt.Printf("  Deploy key: %s (could not read fingerprint)\n", keyPath)
		} else {
			fmt.Printf("  Deploy key: %s\n", strings.TrimSpace(string(output)))
		}
	} else {
		fmt.Println("  Deploy key: not configured")
	}

	// Webhook secret
	if data, err := os.ReadFile(webhookSecretPath); err == nil {
		var secretData map[string]string
		if err := json.Unmarshal(data, &secretData); err == nil {
			secret := secretData["secret"]
			if len(secret) > 8 {
				fmt.Printf("  Webhook secret: %s...%s\n", secret[:4], secret[len(secret)-4:])
			} else {
				fmt.Println("  Webhook secret: configured")
			}
		}
	} else {
		fmt.Println("  Webhook secret: not configured")
	}

	// Webhook URL
	fmt.Printf("  Webhook URL: %s\n", webhookURL(cfg, appName))

	// Config status
	appCfg := cfg.Apps[appName]
	if appCfg.Webhook != nil {
		fmt.Printf("  Config: provider=%s\n", appCfg.Webhook.Provider)
	} else {
		fmt.Println("  Config: webhook not set in app config")
	}

	return nil
}

func runGitHubRemove(cmd *cobra.Command, args []string) error {
	appName := args[0]

	// Verify app exists
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}
	if _, ok := cfg.Apps[appName]; !ok {
		return fmt.Errorf("app %q not found in config", appName)
	}

	root := jibRoot()
	keyPath := filepath.Join(root, "deploy-keys", appName)
	webhookSecretPath := filepath.Join(root, "secrets", "_jib", appName+"-github-webhook.json")

	var removed []string

	// Remove deploy key (private + public)
	if err := os.Remove(keyPath); err != nil && !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "warning: removing deploy key: %v\n", err)
	} else if err == nil {
		removed = append(removed, "deploy key")
	}
	if err := os.Remove(keyPath + ".pub"); err != nil && !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "warning: removing deploy key public: %v\n", err)
	}

	// Remove webhook secret
	if err := os.Remove(webhookSecretPath); err != nil && !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "warning: removing webhook secret: %v\n", err)
	} else if err == nil {
		removed = append(removed, "webhook secret")
	}

	// Remove webhook config from app (only report if the key actually existed)
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
		fmt.Printf("No GitHub integration found for %q.\n", appName)
	} else {
		fmt.Printf("Removed GitHub integration for %q: %s\n", appName, strings.Join(removed, ", "))
	}

	return nil
}

// modifyAppWebhookConfig loads the raw YAML config, navigates to the named
// app entry, calls mutate to modify it, then writes the result back.
func modifyAppWebhookConfig(appName string, mutate func(appMap map[string]interface{})) error {
	cfgPath := configPath()
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		return fmt.Errorf("reading config: %w", err)
	}

	var raw map[string]interface{}
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("parsing config: %w", err)
	}

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

	out, err := yaml.Marshal(raw)
	if err != nil {
		return fmt.Errorf("marshaling config: %w", err)
	}
	return os.WriteFile(cfgPath, out, 0o644)
}
