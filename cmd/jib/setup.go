package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/docker"
	"github.com/hexnickk/jib/internal/network"
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
	addCmd.Flags().StringSlice("domain", nil, "Domain or domain:port (repeatable). Port is inferred from compose if omitted.")
	addCmd.Flags().StringSlice("health", nil, "Health check path:port (repeatable). Inferred from compose if omitted.")
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
		Short: "Remove an app completely",
		Args:  cobra.ExactArgs(1),
		RunE:  runRemove,
	}
	removeCmd.Flags().Bool("force", false, "Skip confirmation prompt")
	removeCmd.Flags().Bool("volumes", false, "Also remove Docker volumes")
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

		// Check domain reachability before SSL
		if !skipSSL {
			for _, d := range appCfg.Domains {
				check := network.CheckDomain(d.Host)
				if check.Warning != "" {
					fmt.Fprintf(os.Stderr, "  ssl: skipping %s — %s\n", d.Host, check.Warning)
					continue
				}
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
		return fmt.Errorf("at least one --domain is required (e.g. --domain example.com)")
	}

	// Parse compose files
	var composeFiles config.StringOrSlice
	if composeFlag != "" {
		composeFiles = strings.Split(composeFlag, ",")
	}

	// Try to infer ports and health from compose file
	repoDir := filepath.Join(jibRoot(), "repos", appName)
	var composeSvcs []docker.ComposeService
	files := []string(composeFiles)
	if len(files) == 0 {
		files = []string{"docker-compose.yml"}
	}
	composeSvcs, _ = docker.ParseComposeServices(repoDir, files)

	inferredPath, inferredPort := docker.InferHealthAndPort(composeSvcs)
	inferredPorts := docker.InferPorts(composeSvcs)

	// Parse domains — port is optional, inferred from compose
	var domains []config.Domain
	for _, d := range domainFlags {
		if host, portStr, ok := strings.Cut(d, ":"); ok {
			port, err := strconv.Atoi(portStr)
			if err != nil {
				return fmt.Errorf("invalid port in domain %q: %w", d, err)
			}
			domains = append(domains, config.Domain{Host: host, Port: port})
		} else {
			// No port — infer from compose
			port := 0
			if len(inferredPorts) > 0 {
				port = inferredPorts[0]
				fmt.Printf("  Inferred port %d from docker-compose.yml for %s\n", port, d)
			}
			if port == 0 {
				return fmt.Errorf("could not infer port for domain %q — specify as domain:port or add ports to docker-compose.yml", d)
			}
			domains = append(domains, config.Domain{Host: d, Port: port})
		}
	}

	// Parse health checks — infer from compose if not provided
	var healthChecks []config.HealthCheck
	if len(healthFlags) > 0 {
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
	} else if inferredPort > 0 {
		healthChecks = []config.HealthCheck{{Path: inferredPath, Port: inferredPort}}
		fmt.Printf("  Inferred health check: %s on port %d\n", inferredPath, inferredPort)
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

	// Run domain reachability checks (warnings only)
	fmt.Println("\nChecking domains...")
	for _, d := range domains {
		checkDomainAndWarn(d.Host)
	}

	if configOnly {
		fmt.Println("\nConfig-only mode: skipping provisioning.")
	} else {
		fmt.Println("\nTo provision (nginx + SSL), run:")
		fmt.Printf("  jib provision %s\n", appName)
	}

	return nil
}

func runRemove(cmd *cobra.Command, args []string) error {
	appName := args[0]
	force, _ := cmd.Flags().GetBool("force")
	volumes, _ := cmd.Flags().GetBool("volumes")

	// Load config to verify app exists and get its details
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	appCfg, ok := cfg.Apps[appName]
	if !ok {
		return fmt.Errorf("app %q not found in config", appName)
	}

	root := jibRoot()

	// Paths that will be removed
	stateFile := filepath.Join(root, "state", appName+".json")
	domainStateFile := filepath.Join(root, "state", appName+".domains.json")
	secretsDir := filepath.Join(root, "secrets", appName)
	repoDir := filepath.Join(root, "repos", appName)
	overrideFile := docker.OverridePath(filepath.Join(root, "overrides"), appName)
	historyFile := filepath.Join(root, "logs", appName+".jsonl")

	// If not --force, show what will be removed and ask for confirmation
	if !force {
		fmt.Printf("Will remove app %q:\n", appName)
		fmt.Println("  - Stop and remove containers")
		if volumes {
			fmt.Println("  - Remove Docker volumes")
		}
		for _, d := range appCfg.Domains {
			fmt.Printf("  - Remove nginx config for %s\n", d.Host)
		}
		fmt.Printf("  - Remove state file: %s\n", stateFile)
		fmt.Printf("  - Remove domain state: %s\n", domainStateFile)
		fmt.Printf("  - Remove secrets: %s\n", secretsDir)
		fmt.Printf("  - Remove repo: %s\n", repoDir)
		fmt.Printf("  - Remove override: %s\n", overrideFile)
		fmt.Printf("  - Remove history: %s\n", historyFile)
		fmt.Println("  - Remove app from config.yml")
		fmt.Println()
		fmt.Print("Continue? [y/N] ")

		scanner := bufio.NewScanner(os.Stdin)
		if !scanner.Scan() {
			if err := scanner.Err(); err != nil {
				return fmt.Errorf("reading confirmation: %w", err)
			}
			fmt.Println("Aborted.")
			return nil
		}
		answer := strings.TrimSpace(strings.ToLower(scanner.Text()))
		if answer != "y" && answer != "yes" {
			fmt.Println("Aborted.")
			return nil
		}
	}

	var removed []string

	// 1. Docker compose down
	compose, err := newCompose(cfg, appName)
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: could not create compose handle: %v\n", err)
	} else {
		ctx := context.Background()
		if volumes {
			err = compose.DownVolumes(ctx)
		} else {
			err = compose.Down(ctx)
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "warning: docker compose down: %v\n", err)
		} else {
			removed = append(removed, "containers")
			if volumes {
				removed = append(removed, "volumes")
			}
		}
	}

	// 2. Remove nginx configs
	if len(appCfg.Domains) > 0 {
		p := newProxy(cfg)
		if err := p.RemoveConfigs(appName, appCfg.Domains); err != nil {
			fmt.Fprintf(os.Stderr, "warning: removing nginx configs: %v\n", err)
		} else {
			removed = append(removed, "nginx configs")
		}

		// Reload nginx (test first)
		if err := p.Test(); err != nil {
			fmt.Fprintf(os.Stderr, "warning: nginx config test failed: %v\n", err)
		} else if err := p.Reload(); err != nil {
			fmt.Fprintf(os.Stderr, "warning: nginx reload: %v\n", err)
		} else {
			removed = append(removed, "nginx reloaded")
		}
	}

	// 3. Remove state file
	if err := os.Remove(stateFile); err != nil && !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "warning: removing state file: %v\n", err)
	} else if err == nil {
		removed = append(removed, "state file")
	}

	// 4. Remove domain state file
	if err := os.Remove(domainStateFile); err != nil && !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "warning: removing domain state file: %v\n", err)
	} else if err == nil {
		removed = append(removed, "domain state")
	}

	// 5. Remove secrets directory
	if _, statErr := os.Stat(secretsDir); statErr == nil {
		if err := os.RemoveAll(secretsDir); err != nil {
			fmt.Fprintf(os.Stderr, "warning: removing secrets dir: %v\n", err)
		} else {
			removed = append(removed, "secrets")
		}
	}

	// 6. Remove repo directory
	if _, statErr := os.Stat(repoDir); statErr == nil {
		if err := os.RemoveAll(repoDir); err != nil {
			fmt.Fprintf(os.Stderr, "warning: removing repo dir: %v\n", err)
		} else {
			removed = append(removed, "repo")
		}
	}

	// 7. Remove override file
	if err := os.Remove(overrideFile); err != nil && !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "warning: removing override file: %v\n", err)
	} else if err == nil {
		removed = append(removed, "override")
	}

	// 7b. Remove history log
	if err := os.Remove(historyFile); err != nil && !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "warning: removing history file: %v\n", err)
	} else if err == nil {
		removed = append(removed, "history")
	}

	// 8. Remove app from config.yml
	cfgPath := configPath()
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		return fmt.Errorf("reading config for removal: %w", err)
	}

	var raw map[string]interface{}
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("parsing config: %w", err)
	}

	if appsRaw, ok := raw["apps"]; ok {
		if appsMap, ok := appsRaw.(map[string]interface{}); ok {
			delete(appsMap, appName)
		}
	}

	out, err := yaml.Marshal(raw)
	if err != nil {
		return fmt.Errorf("marshaling config: %w", err)
	}

	if err := os.WriteFile(cfgPath, out, 0o644); err != nil {
		return fmt.Errorf("writing config: %w", err)
	}
	removed = append(removed, "config entry")

	fmt.Printf("\nRemoved app %q: %s\n", appName, strings.Join(removed, ", "))
	return nil
}

// checkDomainAndWarn runs domain checks and prints warnings.
func checkDomainAndWarn(domain string) {
	check := network.CheckDomain(domain)

	if check.Warning != "" {
		fmt.Fprintf(os.Stderr, "  ⚠ %s: %s\n", domain, check.Warning)
		return
	}

	switch check.Transport {
	case "direct":
		fmt.Printf("  ✓ %s → this server\n", domain)
	case "cloudflare":
		fmt.Printf("  ✓ %s → Cloudflare (%s)\n", domain, check.IPs[0])
	case "tailscale":
		fmt.Printf("  ✓ %s → Tailscale (%s)\n", domain, check.IPs[0])
	default:
		fmt.Fprintf(os.Stderr, "  ⚠ %s → %s (not this server)\n", domain, check.IPs[0])
	}
}
