package main

import (
	"fmt"
	"os"
	"os/exec"
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
	rootCmd.AddCommand(&cobra.Command{
		Use:   "provision [app]",
		Short: "Re-reconcile infra for app (or all) -- idempotent",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) > 0 {
				fmt.Printf("[provision] Would re-provision infrastructure for app %q:\n", args[0])
			} else {
				fmt.Println("[provision] Would re-provision infrastructure for all apps:")
			}
			fmt.Println("  - Clone/update git repo")
			fmt.Println("  - Generate and write nginx configs")
			fmt.Println("  - Obtain SSL certificates")
			fmt.Println("  - Reload nginx")
			return nil
		},
	})

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

func runEdit(cmd *cobra.Command, args []string) error {
	editor := os.Getenv("EDITOR")
	if editor == "" {
		editor = os.Getenv("VISUAL")
	}
	if editor == "" {
		editor = "vi"
	}

	cfgPath := config.DefaultConfigPath()

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
	cfgPath := config.DefaultConfigPath()
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
