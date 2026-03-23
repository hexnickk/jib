package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/hexnickk/jib/internal/config"
	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

func registerSetupCommands(rootCmd *cobra.Command) {
	// jib init
	rootCmd.AddCommand(&cobra.Command{
		Use:   "init",
		Short: "Interactive onboarding: deps, user, config, first app",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Println("[init] Would perform interactive onboarding:")
			fmt.Println("  1. Check and install dependencies (docker, nginx, certbot, etc.)")
			fmt.Println("  2. Create jib system user and directories under /opt/jib/")
			fmt.Println("  3. Generate initial config.yml")
			fmt.Println("  4. Set up systemd service for jib daemon")
			fmt.Println("  5. Prompt to add first app")
			return nil
		},
	})

	// jib add <app>
	addCmd := &cobra.Command{
		Use:   "add <app>",
		Short: "Add app: config + clone + key + nginx + SSL",
		Args:  cobra.ExactArgs(1),
		RunE:  runAdd,
	}
	addCmd.Flags().String("repo", "", "GitHub repo (org/name)")
	addCmd.Flags().String("compose", "", "Compose file path (or comma-separated list)")
	addCmd.Flags().StringSlice("domain", nil, "Domain:port mapping (repeatable)")
	addCmd.Flags().StringSlice("health", nil, "Health check path:port (repeatable)")
	addCmd.Flags().Bool("config-only", false, "Write config without provisioning")
	rootCmd.AddCommand(addCmd)

	// jib provision [app]
	provisionCmd := &cobra.Command{
		Use:   "provision [app]",
		Short: "Re-reconcile infra for app (or all) -- idempotent",
		Args:  cobra.MaximumNArgs(1),
		RunE:  runProvision,
	}
	provisionCmd.Flags().Bool("skip-ssl", false, "Skip SSL certificate provisioning")
	rootCmd.AddCommand(provisionCmd)

	// jib remove <app>
	removeCmd := &cobra.Command{
		Use:   "remove <app>",
		Short: "Remove an app",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			force, _ := cmd.Flags().GetBool("force")
			fmt.Printf("[remove] Would remove app %q:\n", args[0])
			fmt.Println("  - Stop and remove containers")
			fmt.Println("  - Remove nginx configs")
			fmt.Println("  - Remove state and secrets")
			fmt.Println("  - Remove app from config.yml")
			if !force {
				fmt.Println("  Use --force to skip confirmation prompt.")
			}
			return nil
		},
	}
	removeCmd.Flags().Bool("force", false, "Skip confirmation prompt")
	rootCmd.AddCommand(removeCmd)

	// jib edit
	rootCmd.AddCommand(&cobra.Command{
		Use:   "edit",
		Short: "$EDITOR config.yml + validate on save",
		RunE:  runEdit,
	})
}

func runProvision(cmd *cobra.Command, args []string) error {
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	skipSSL, _ := cmd.Flags().GetBool("skip-ssl")
	p := newProxy(cfg)
	sslMgr := newSSLManager(cfg)

	// Determine which apps to provision
	apps := make(map[string]config.App)
	if len(args) > 0 {
		appCfg, ok := cfg.Apps[args[0]]
		if !ok {
			return fmt.Errorf("app %q not found in config", args[0])
		}
		apps[args[0]] = appCfg
	} else {
		apps = cfg.Apps
	}

	for name, appCfg := range apps {
		fmt.Printf("Provisioning %s...\n", name)

		// Remove stale nginx configs for domains no longer in config.
		// Collect all domains currently configured for this app.
		currentDomains := make(map[string]bool)
		for _, d := range appCfg.Domains {
			currentDomains[d.Host+".conf"] = true
		}
		// Check all existing nginx configs and remove any that belonged
		// to this app's old domain list but are no longer configured.
		// We identify stale configs by checking if a conf file exists
		// that is NOT in the current domain set.
		// First, collect all conf files from previous provision for this app.
		if prevAppCfg, err := loadPreviousDomains(name); err == nil {
			var staleDomains []config.Domain
			for _, d := range prevAppCfg {
				if !currentDomains[d.Host+".conf"] {
					staleDomains = append(staleDomains, d)
				}
			}
			if len(staleDomains) > 0 {
				if err := p.RemoveConfigs(name, staleDomains); err != nil {
					fmt.Fprintf(os.Stderr, "  warning: removing stale configs: %v\n", err)
				}
				for _, d := range staleDomains {
					fmt.Printf("  nginx: removed stale %s.conf\n", d.Host)
				}
			}
		}

		// Generate and write nginx configs
		configs, err := p.GenerateConfig(name, appCfg)
		if err != nil {
			return fmt.Errorf("generating nginx config for %s: %w", name, err)
		}
		if err := p.WriteConfigs(configs); err != nil {
			return fmt.Errorf("writing nginx configs for %s: %w", name, err)
		}
		for filename := range configs {
			fmt.Printf("  nginx: %s\n", filename)
		}

		// Save current domains for future stale detection.
		savePreviousDomains(name, appCfg.Domains)

		// Obtain SSL certificates
		if !skipSSL {
			for _, d := range appCfg.Domains {
				fmt.Printf("  ssl: obtaining cert for %s...\n", d.Host)
				if err := sslMgr.Obtain(context.Background(), d.Host); err != nil {
					fmt.Fprintf(os.Stderr, "  ssl: warning: %s: %v\n", d.Host, err)
				} else {
					fmt.Printf("  ssl: %s OK\n", d.Host)
				}
			}
		}
	}

	// Test and reload nginx
	if err := p.Test(); err != nil {
		return fmt.Errorf("nginx config test: %w", err)
	}
	if err := p.Reload(); err != nil {
		return fmt.Errorf("nginx reload: %w", err)
	}
	fmt.Println("Nginx reloaded.")
	return nil
}

// loadPreviousDomains reads the previously provisioned domain list for an app.
func loadPreviousDomains(app string) ([]config.Domain, error) {
	path := filepath.Join(jibRoot(), "state", app+".domains.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var domains []config.Domain
	if err := json.Unmarshal(data, &domains); err != nil {
		return nil, err
	}
	return domains, nil
}

// savePreviousDomains persists the current domain list for stale detection on next provision.
func savePreviousDomains(app string, domains []config.Domain) {
	dir := filepath.Join(jibRoot(), "state")
	_ = os.MkdirAll(dir, 0o755)
	data, err := json.Marshal(domains)
	if err != nil {
		return
	}
	_ = os.WriteFile(filepath.Join(dir, app+".domains.json"), data, 0o644)
}

func runEdit(cmd *cobra.Command, args []string) error {
	editor := os.Getenv("EDITOR")
	if editor == "" {
		editor = os.Getenv("VISUAL")
	}
	if editor == "" {
		editor = "vi"
	}

	cfgPath := configPath()

	// Check the file exists before editing
	if _, err := os.Stat(cfgPath); err != nil {
		return fmt.Errorf("config file not found at %s: %w", cfgPath, err)
	}

	editorCmd := exec.Command(editor, cfgPath)
	editorCmd.Stdin = os.Stdin
	editorCmd.Stdout = os.Stdout
	editorCmd.Stderr = os.Stderr

	if err := editorCmd.Run(); err != nil {
		return fmt.Errorf("editor exited with error: %w", err)
	}

	// Validate on save
	_, err := config.LoadConfig(cfgPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Warning: config validation failed: %v\n", err)
		fmt.Fprintln(os.Stderr, "The file was saved but contains errors. Run 'jib edit' again to fix.")
		return err
	}

	fmt.Println("Config saved and validated successfully.")
	return nil
}

func runAdd(cmd *cobra.Command, args []string) error {
	appName := args[0]

	repo, _ := cmd.Flags().GetString("repo")
	composeFlag, _ := cmd.Flags().GetString("compose")
	domainFlags, _ := cmd.Flags().GetStringSlice("domain")
	healthFlags, _ := cmd.Flags().GetStringSlice("health")
	configOnly, _ := cmd.Flags().GetBool("config-only")

	if repo == "" {
		return fmt.Errorf("--repo is required (e.g. --repo org/repo-name)")
	}
	if len(domainFlags) == 0 {
		return fmt.Errorf("at least one --domain is required (e.g. --domain example.com:3000)")
	}

	// Parse domains
	var domains []config.Domain
	for _, d := range domainFlags {
		host, portStr, ok := strings.Cut(d, ":")
		if !ok {
			return fmt.Errorf("invalid domain format %q, expected host:port", d)
		}
		port, err := strconv.Atoi(portStr)
		if err != nil {
			return fmt.Errorf("invalid port in domain %q: %w", d, err)
		}
		domains = append(domains, config.Domain{Host: host, Port: port})
	}

	// Parse health checks
	var healthChecks []config.HealthCheck
	for _, h := range healthFlags {
		path, portStr, ok := strings.Cut(h, ":")
		if !ok {
			return fmt.Errorf("invalid health check format %q, expected /path:port", h)
		}
		port, err := strconv.Atoi(portStr)
		if err != nil {
			return fmt.Errorf("invalid port in health check %q: %w", h, err)
		}
		healthChecks = append(healthChecks, config.HealthCheck{Path: path, Port: port})
	}

	// Parse compose files
	var composeFiles config.StringOrSlice
	if composeFlag != "" {
		composeFiles = strings.Split(composeFlag, ",")
	}

	newApp := config.App{
		Repo:    repo,
		Compose: composeFiles,
		Domains: domains,
		Health:  healthChecks,
	}

	// Load or create config
	cfgPath := configPath()
	data, err := os.ReadFile(cfgPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("reading config: %w", err)
	}

	var raw map[string]interface{}
	if len(data) > 0 {
		if err := yaml.Unmarshal(data, &raw); err != nil {
			return fmt.Errorf("parsing config: %w", err)
		}
	}
	if raw == nil {
		raw = make(map[string]interface{})
	}

	// Marshal the new app to a generic map for YAML insertion
	appData, err := yaml.Marshal(newApp)
	if err != nil {
		return fmt.Errorf("marshaling app config: %w", err)
	}
	var appMap interface{}
	if err := yaml.Unmarshal(appData, &appMap); err != nil {
		return fmt.Errorf("parsing app config: %w", err)
	}

	// Get or create apps section
	appsRaw, ok := raw["apps"]
	if !ok {
		appsRaw = make(map[string]interface{})
		raw["apps"] = appsRaw
	}
	appsMap, ok := appsRaw.(map[string]interface{})
	if !ok {
		return fmt.Errorf("apps section in config is not a map")
	}

	if _, exists := appsMap[appName]; exists {
		return fmt.Errorf("app %q already exists in config", appName)
	}

	appsMap[appName] = appMap

	out, err := yaml.Marshal(raw)
	if err != nil {
		return fmt.Errorf("marshaling config: %w", err)
	}

	if err := os.WriteFile(cfgPath, out, 0o644); err != nil {
		return fmt.Errorf("writing config: %w", err)
	}

	fmt.Printf("Added app %q to config.\n", appName)

	// Validate
	if _, err := config.LoadConfig(cfgPath); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: config validation: %v\n", err)
	}

	if configOnly {
		fmt.Println("Config-only mode: skipping provisioning.")
	} else {
		fmt.Println("To provision (clone repo, setup nginx, obtain SSL), run:")
		fmt.Printf("  jib provision %s\n", appName)
	}

	return nil
}
