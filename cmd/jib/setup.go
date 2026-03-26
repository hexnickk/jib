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
	"github.com/hexnickk/jib/internal/deploy"
	"github.com/hexnickk/jib/internal/docker"
	gitPkg "github.com/hexnickk/jib/internal/git"
	ghPkg "github.com/hexnickk/jib/internal/github"
	"github.com/hexnickk/jib/internal/network"
	"github.com/hexnickk/jib/internal/platform"
	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

func registerSetupCommands(rootCmd *cobra.Command) {
	// jib init
	initCmd := &cobra.Command{
		Use:   "init",
		Short: "Bootstrap server: install deps, create config, set up directories",
		RunE:  runInit,
	}
	initCmd.Flags().Bool("non-interactive", false, "Use all defaults, skip prompts (for scripting)")
	initCmd.Flags().Bool("skip-install", false, "Assume deps are already installed, just create config/dirs")
	rootCmd.AddCommand(initCmd)

	// jib add <app>
	addCmd := &cobra.Command{
		Use:   "add <app>",
		Short: "Add app: config + clone + key + nginx + SSL",
		Args:  exactArgs(1),
		RunE:  runAdd,
	}
	addCmd.Flags().String("repo", "", "GitHub repo (org/name)")
	addCmd.Flags().String("provider", "", "Git auth provider name (from 'jib github key/app setup')")
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
		Args:  exactArgs(1),
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

// systemd unit file for the jib daemon.
const jibServiceUnit = `[Unit]
Description=Jib Deploy Daemon
After=docker.service nginx.service

[Service]
ExecStart=/usr/local/bin/jib _daemon
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`

func runInit(cmd *cobra.Command, args []string) error {
	nonInteractive, _ := cmd.Flags().GetBool("non-interactive")
	skipInstall, _ := cmd.Flags().GetBool("skip-install")

	scanner := bufio.NewScanner(os.Stdin)
	cfgPath := configPath()
	root := jibRoot()
	firstRun := !fileExists(cfgPath)

	if firstRun {
		fmt.Println("=== Jib Server Bootstrap ===")
	} else {
		fmt.Println("=== Jib Server Converge ===")
	}
	fmt.Println()

	// --- Ensure: dependencies installed ---
	if !skipInstall {
		fmt.Println("Checking dependencies...")
		if err := ensureDeps(); err != nil {
			return err
		}

		// Enable and start Docker and Nginx
		for _, svc := range []string{"docker", "nginx"} {
			ensureSystemdService(svc)
		}
	} else {
		fmt.Println("Skipping dependency installation (--skip-install).")
	}

	// --- First-run only: interactive prompts for SSL and rclone ---
	certbotEmail := ""
	if firstRun {
		sslChoice := 1
		if !nonInteractive {
			fmt.Println("\nDomain/SSL management:")
			fmt.Println("  1. Certbot (Let's Encrypt) — recommended for direct server access")
			fmt.Println("  2. Cloudflare Tunnel")
			fmt.Println("  3. Tailscale")
			fmt.Println("  4. None — I'll manage SSL myself")
			fmt.Print("Choose [1-4, default 1]: ")

			if scanner.Scan() {
				choice := strings.TrimSpace(scanner.Text())
				if choice != "" {
					n, err := strconv.Atoi(choice)
					if err != nil || n < 1 || n > 4 {
						fmt.Println("Invalid choice, using default (1: Certbot).")
					} else {
						sslChoice = n
					}
				}
			}
		}

		switch sslChoice {
		case 1:
			if !skipInstall {
				fmt.Println("\nInstalling certbot...")
				installCmd := sudoCmd("apt-get", "install", "-y", "certbot", "python3-certbot-nginx")
				installCmd.Stdout = os.Stdout
				installCmd.Stderr = os.Stderr
				if err := installCmd.Run(); err != nil {
					fmt.Fprintf(os.Stderr, "warning: certbot installation failed: %v\n", err)
				}
			}
			if !nonInteractive {
				fmt.Print("Email for Let's Encrypt notifications: ")
				if scanner.Scan() {
					certbotEmail = strings.TrimSpace(scanner.Text())
				}
			}
		case 2:
			fmt.Println("\nRun 'jib cloudflare setup' after init to configure.")
		case 3:
			fmt.Println("\nRun 'jib tailscale setup' after init to configure.")
		case 4:
			fmt.Println("\nSkipping SSL setup.")
		}

		if !nonInteractive && !skipInstall {
			fmt.Print("\nInstall rclone for backups? [y/N]: ")
			if scanner.Scan() {
				answer := strings.TrimSpace(strings.ToLower(scanner.Text()))
				if answer == "y" || answer == "yes" {
					fmt.Println("Installing rclone...")
					installCmd := sudoCmd("apt-get", "install", "-y", "rclone")
					installCmd.Stdout = os.Stdout
					installCmd.Stderr = os.Stderr
					if err := installCmd.Run(); err != nil {
						fmt.Fprintf(os.Stderr, "warning: rclone installation failed: %v\n", err)
					}
				}
			}
		}
	}

	// --- Ensure: jib group exists and current user is a member ---
	ensureJibGroup()

	// --- Ensure: current user can access Docker ---
	ensureDockerGroup()

	// --- Ensure: directory structure with correct ownership/permissions ---
	ensureDirs(root)

	// --- Ensure: config.yml exists ---
	if firstRun {
		fmt.Println("\nGenerating config.yml...")
		cfgContent := fmt.Sprintf("config_version: %d\npoll_interval: 5m\n", config.LatestConfigVersion)
		if certbotEmail != "" {
			cfgContent += fmt.Sprintf("certbot_email: %s\n", certbotEmail)
		}
		cfgContent += "apps: {}\n"

		writeCfgCmd := sudoCmd("tee", cfgPath)
		writeCfgCmd.Stdin = strings.NewReader(cfgContent)
		writeCfgCmd.Stdout = nil
		if err := writeCfgCmd.Run(); err != nil {
			return fmt.Errorf("writing config: %w", err)
		}
		fmt.Printf("  Written to %s\n", cfgPath)
	} else {
		fmt.Println("\nConfig exists, skipping generation.")
	}

	// --- Ensure: systemd unit installed and running ---
	ensureJibDaemon()

	fmt.Println()
	fmt.Println("Jib initialized! Next:")
	fmt.Println("  jib add <app> --repo org/repo --domain example.com")
	fmt.Println("  jib deploy <app>")

	return nil
}

// userInGroup checks if a user belongs to a group (per /etc/group, not the active session).
func userInGroup(user, group string) bool {
	out, err := exec.Command("id", "-nG", user).Output()
	if err != nil {
		return false
	}
	return strings.Contains(" "+strings.TrimSpace(string(out))+" ", " "+group+" ")
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// ensureDeps checks core dependencies and installs any that are missing.
func ensureDeps() error {
	depResults := platform.CheckAllDependencies()

	coreDeps := map[string]bool{
		"Docker": false, "Docker Compose": false, "Nginx": false, "Git": false,
	}
	for _, r := range depResults {
		if _, isCore := coreDeps[r.Name]; isCore {
			coreDeps[r.Name] = r.Installed
			if r.Installed {
				fmt.Printf("  %s: OK (v%s)\n", r.Name, r.Version)
			} else {
				fmt.Printf("  %s: MISSING\n", r.Name)
			}
		}
	}

	var toInstall []string
	if !coreDeps["Docker"] {
		toInstall = append(toInstall, "docker.io")
	}
	if !coreDeps["Docker Compose"] {
		toInstall = append(toInstall, "docker-compose-v2")
	}
	if !coreDeps["Nginx"] {
		toInstall = append(toInstall, "nginx")
	}
	if !coreDeps["Git"] {
		toInstall = append(toInstall, "git")
	}

	if len(toInstall) == 0 {
		return nil
	}

	fmt.Printf("\nInstalling: %s\n", strings.Join(toInstall, ", "))

	updateCmd := sudoCmd("apt-get", "update")
	updateCmd.Stdout = os.Stdout
	updateCmd.Stderr = os.Stderr
	if err := updateCmd.Run(); err != nil {
		return fmt.Errorf("apt-get update failed: %w", err)
	}

	installArgs := append([]string{"install", "-y"}, toInstall...)
	installCmd := sudoCmd("apt-get", installArgs...)
	installCmd.Stdout = os.Stdout
	installCmd.Stderr = os.Stderr
	if err := installCmd.Run(); err != nil {
		return fmt.Errorf("apt-get install failed: %w", err)
	}

	return nil
}

// ensureSystemdService enables and starts a systemd service if not already active.
func ensureSystemdService(name string) {
	// Check if already active.
	if err := exec.Command("systemctl", "is-active", "--quiet", name).Run(); err == nil {
		return
	}
	enableCmd := sudoCmd("systemctl", "enable", "--now", name)
	enableCmd.Stdout = os.Stdout
	enableCmd.Stderr = os.Stderr
	if err := enableCmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: systemctl enable --now %s: %v\n", name, err)
	} else {
		fmt.Printf("  %s: enabled and started\n", name)
	}
}

// ensureJibGroup ensures the jib group exists and the current user is a member.
func ensureJibGroup() {
	fmt.Println("\nEnsuring jib group...")
	_ = sudoCmd("groupadd", "-f", "jib").Run() // ignore: group may already exist

	currentUser := os.Getenv("SUDO_USER")
	if currentUser == "" {
		currentUser = os.Getenv("USER")
	}
	if currentUser == "" || currentUser == "root" {
		fmt.Println("  jib group: OK")
		return
	}

	// Check if user is already in the group.
	if userInGroup(currentUser, "jib") {
		fmt.Printf("  %s: already in jib group\n", currentUser)
		return
	}

	if err := sudoCmd("usermod", "-aG", "jib", currentUser).Run(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: could not add %s to jib group: %v\n", currentUser, err)
		return
	}
	fmt.Printf("  Added '%s' to jib group\n", currentUser)
}

// ensureDockerGroup ensures the current user is in the docker group.
func ensureDockerGroup() {
	currentUser := os.Getenv("SUDO_USER")
	if currentUser == "" {
		currentUser = os.Getenv("USER")
	}
	if currentUser == "" || currentUser == "root" {
		return
	}

	if userInGroup(currentUser, "docker") {
		return
	}

	fmt.Println("\nAdding user to docker group...")
	if err := sudoCmd("usermod", "-aG", "docker", currentUser).Run(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: could not add %s to docker group: %v\n", currentUser, err)
		return
	}
	fmt.Printf("  Added '%s' to docker group\n", currentUser)
	fmt.Println("  NOTE: Log out and back in (or run 'newgrp docker') for this to take effect.")
}

// ensureDirs ensures /opt/jib directory structure exists with correct ownership and permissions.
func ensureDirs(root string) {
	fmt.Println("\nEnsuring directory structure...")
	dirs := []string{
		"state", "secrets", "repos", "overrides",
		"nginx", "backups", "locks", "deploy-keys", "logs",
	}
	for _, dir := range dirs {
		dirPath := filepath.Join(root, dir)
		if err := sudoCmd("mkdir", "-p", dirPath).Run(); err != nil {
			fmt.Fprintf(os.Stderr, "  warning: creating %s: %v\n", dirPath, err)
		}
	}
	// Converge ownership and permissions every run.
	if err := sudoCmd("chown", "-R", "root:jib", root).Run(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: chown %s: %v\n", root, err)
	}
	if err := sudoCmd("chmod", "-R", "u=rwX,g=rwX,o=", root).Run(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: chmod %s: %v\n", root, err)
	}
	if err := sudoCmd("chmod", "2770", filepath.Join(root, "secrets")).Run(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: chmod secrets: %v\n", err)
	}
	fmt.Printf("  %s: OK (root:jib)\n", root)
}

// ensureJibDaemon ensures the jib systemd unit is installed, loaded, and running.
func ensureJibDaemon() {
	fmt.Println("\nEnsuring jib daemon...")
	unitPath := "/etc/systemd/system/jib.service"

	// Always write the unit file to pick up any changes.
	writeCmd := sudoCmd("tee", unitPath)
	writeCmd.Stdin = strings.NewReader(jibServiceUnit)
	writeCmd.Stdout = nil
	if err := writeCmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: could not write %s: %v\n", unitPath, err)
		return
	}

	if err := sudoCmd("systemctl", "daemon-reload").Run(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: systemctl daemon-reload: %v\n", err)
	}

	// Enable and start if not already running.
	if err := exec.Command("systemctl", "is-active", "--quiet", "jib").Run(); err == nil {
		fmt.Println("  jib daemon: running")
		return
	}
	if err := sudoCmd("systemctl", "enable", "--now", "jib").Run(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: systemctl enable --now jib: %v\n", err)
	} else {
		fmt.Println("  jib daemon: started")
	}
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
		appCfg, err := requireApp(cfg, args[0])
		if err != nil {
			return err
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
	providerName, _ := cmd.Flags().GetString("provider")
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

	// Check early if app already exists to avoid cloning/generating before failing.
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}
	if _, exists := cfg.Apps[appName]; exists {
		return fmt.Errorf("app %q already exists in config", appName)
	}

	ctx := context.Background()
	root := jibRoot()
	repoDirPath := repoDir(appName, repo)

	// Parse compose files
	var composeFiles config.StringOrSlice
	if composeFlag != "" {
		composeFiles = strings.Split(composeFlag, ",")
	}

	// Parse domains (port will be filled in after clone + inference)
	var domains []config.Domain
	for _, d := range domainFlags {
		if host, portStr, ok := strings.Cut(d, ":"); ok {
			port, err := strconv.Atoi(portStr)
			if err != nil {
				return fmt.Errorf("invalid port in domain %q: %w", d, err)
			}
			domains = append(domains, config.Domain{Host: host, Port: port})
		} else {
			domains = append(domains, config.Domain{Host: d})
		}
	}

	// Parse health checks if explicitly provided
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

	// --- Step 1: Resolve provider and clone ---
	if repo != "local" && !configOnly {
		// Resolve provider
		var provider *config.GitHubProvider
		if providerName == "" {
			// Backward compat: check for legacy deploy key named by app
			legacyKeyPath := filepath.Join(root, "deploy-keys", appName)
			if _, err := os.Stat(legacyKeyPath); err == nil {
				fmt.Printf("Using legacy deploy key at %s\n", legacyKeyPath)
			} else {
				return fmt.Errorf("--provider is required for remote repos\n\n  Set up a provider first:\n    jib github key setup <name>     (SSH deploy key)\n    jib github app setup <name>     (GitHub App)\n\n  Then: jib add %s --repo %s --domain %s --provider <name>", appName, repo, domainFlags[0])
			}
		} else {
			cfg, err := loadConfig()
			if err != nil {
				return fmt.Errorf("loading config: %w", err)
			}
			p, ok := cfg.LookupProvider(providerName)
			if !ok {
				return fmt.Errorf("provider %q not found (see 'jib github key setup' or 'jib github app setup')", providerName)
			}
			provider = &p
		}

		if !gitPkg.IsRepo(repoDirPath) {
			branch := "main"
			fmt.Printf("\nCloning %s...\n", repo)

			if err := cloneWithProvider(ctx, root, repo, repoDirPath, branch, provider, providerName, appName); err != nil {
				return fmt.Errorf("cloning repo: %w", err)
			}
		} else {
			fmt.Printf("\nRepo already cloned at %s\n", repoDirPath)
		}
	}

	// --- Step 3: Infer ports and health from compose/Dockerfile ---
	if !configOnly {
		files := []string(composeFiles)
		if len(files) == 0 {
			files = []string{"docker-compose.yml"}
		}

		if docker.NeedsGeneratedCompose(repoDirPath, files) {
			// Dockerfile-only repo — generate compose and assign port
			fmt.Println("\nNo docker-compose.yml found, will generate from Dockerfile.")
			overrideDir := filepath.Join(root, "overrides")
			composePath, hostPort, err := docker.GenerateComposeForDockerfile(appName, repoDirPath, overrideDir, 0)
			if err != nil {
				return fmt.Errorf("generating compose from Dockerfile: %w", err)
			}
			composeFiles = config.StringOrSlice{composePath}
			fmt.Printf("  Generated compose: %s (port %d)\n", composePath, hostPort)

			for i := range domains {
				if domains[i].Port == 0 {
					domains[i].Port = hostPort
				}
			}
		} else {
			// Has compose file — infer from it
			composeSvcs, _ := docker.ParseComposeServices(repoDirPath, files)
			inferredPath, inferredPort := docker.InferHealthAndPort(composeSvcs)
			inferredPorts := docker.InferPorts(composeSvcs)

			for i := range domains {
				if domains[i].Port == 0 && len(inferredPorts) > 0 {
					domains[i].Port = inferredPorts[0]
					fmt.Printf("  Inferred port %d for %s\n", inferredPorts[0], domains[i].Host)
				}
			}

			if len(healthChecks) == 0 && inferredPort > 0 {
				healthChecks = []config.HealthCheck{{Path: inferredPath, Port: inferredPort}}
				fmt.Printf("  Inferred health check: %s:%d\n", inferredPath, inferredPort)
			}
		}
	}

	// Check all domains have ports
	for _, d := range domains {
		if d.Port == 0 {
			return fmt.Errorf("could not determine port for domain %q — specify as domain:port", d.Host)
		}
	}

	// --- Step 4: Save to config ---
	cfgPath := configPath()
	var resources *config.Resources

	if err := config.ModifyRawConfig(cfgPath, func(raw map[string]interface{}) error {
		existingApps := 0
		if appsRaw, ok := raw["apps"]; ok {
			if appsMap, ok := appsRaw.(map[string]interface{}); ok {
				existingApps = len(appsMap)
			}
		}

		if sr, err := platform.DetectResources(); err == nil {
			appCount := existingApps + 1
			mem, cpus := platform.SuggestAppResources(sr, appCount)
			resources = &config.Resources{Memory: mem, CPUs: cpus}
			fmt.Printf("  Resource limits: memory=%s, cpus=%s (%d app(s))\n", mem, cpus, appCount)
		}

		newApp := config.App{
			Repo:      repo,
			Provider:  providerName,
			Compose:   composeFiles,
			Domains:   domains,
			Health:    healthChecks,
			Resources: resources,
		}

		appData, err := yaml.Marshal(newApp)
		if err != nil {
			return fmt.Errorf("marshaling app config: %w", err)
		}
		var appMap interface{}
		if err := yaml.Unmarshal(appData, &appMap); err != nil {
			return fmt.Errorf("parsing app config: %w", err)
		}

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
		return nil
	}); err != nil {
		return err
	}

	fmt.Printf("\nAdded app %q to config.\n", appName)

	if configOnly {
		fmt.Println("Config-only mode: skipping deploy.")
		return nil
	}

	// --- Step 5: Deploy ---
	fmt.Println("\nDeploying...")
	cfg, err = loadConfig()
	if err != nil {
		return fmt.Errorf("reloading config: %w", err)
	}

	engine := newEngine(cfg)
	result, err := engine.Deploy(ctx, deploy.DeployOptions{
		App:     appName,
		Force:   true,
		Trigger: "add",
		User:    currentUser(),
	})
	if err != nil {
		return fmt.Errorf("deploy failed: %w", err)
	}
	if !result.Success {
		return fmt.Errorf("deploy failed: %s", result.Error)
	}

	fmt.Printf("\nApp %q deployed successfully (SHA: %s)\n", appName, result.DeployedSHA[:8])

	// --- Step 6: Provision nginx + SSL ---
	fmt.Println("\nProvisioning nginx...")
	appCfg := cfg.Apps[appName]
	p := newProxy(cfg)
	configs, err := p.GenerateConfig(appName, appCfg)
	if err != nil {
		return fmt.Errorf("generating nginx config: %w", err)
	}
	if err := p.WriteConfigs(configs); err != nil {
		return fmt.Errorf("writing nginx configs: %w", err)
	}
	for filename := range configs {
		fmt.Printf("  nginx: %s\n", filename)
	}
	savePreviousDomains(appName, appCfg.Domains)
	if err := p.Test(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: nginx config test failed: %v\n", err)
	} else if err := p.Reload(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: nginx reload failed: %v\n", err)
	} else {
		fmt.Println("  nginx: reloaded")
	}

	// SSL
	sslMgr := newSSLManager(cfg)
	for _, d := range appCfg.Domains {
		check := network.CheckDomain(d.Host)
		if check.Warning != "" {
			fmt.Fprintf(os.Stderr, "  ssl: skipping %s — %s\n", d.Host, check.Warning)
			continue
		}
		fmt.Printf("  ssl: obtaining cert for %s...\n", d.Host)
		if err := sslMgr.Obtain(ctx, d.Host); err != nil {
			fmt.Fprintf(os.Stderr, "  ssl: warning: %s: %v\n", d.Host, err)
		} else {
			fmt.Printf("  ssl: %s OK\n", d.Host)
		}
	}

	// --- Step 7: Domain checks (warnings only) ---
	fmt.Println("\nChecking domains...")
	for _, d := range domains {
		checkDomainAndWarn(d.Host)
	}

	return nil
}

// cloneWithProvider clones a repo using the specified provider's credentials.
// If provider is nil, falls back to a legacy deploy key at deploy-keys/<appName>.
func cloneWithProvider(ctx context.Context, root, repo, repoDir, branch string, provider *config.GitHubProvider, providerName, appName string) error {
	if provider == nil {
		// Legacy: deploy key named by app
		keyPath := filepath.Join(root, "deploy-keys", appName)
		repoURL := ghPkg.SSHCloneURL(repo)
		if err := gitPkg.Clone(ctx, repoURL, repoDir, branch, keyPath); err != nil {
			return err
		}
		if err := gitPkg.ConfigureSSHKey(repoDir, keyPath); err != nil {
			fmt.Fprintf(os.Stderr, "  warning: configuring SSH key: %v\n", err)
		}
		return nil
	}

	switch provider.Type {
	case ghPkg.ProviderTypeKey:
		keyPath := ghPkg.KeyPath(root, providerName)
		repoURL := ghPkg.SSHCloneURL(repo)

		// Verify access first
		fmt.Println("Verifying repository access...")
		if err := gitPkg.LsRemote(ctx, repoURL, keyPath); err != nil {
			return fmt.Errorf("cannot access repo — is the deploy key added to GitHub?\n  %w", err)
		}

		if err := gitPkg.Clone(ctx, repoURL, repoDir, branch, keyPath); err != nil {
			return err
		}
		if err := gitPkg.ConfigureSSHKey(repoDir, keyPath); err != nil {
			fmt.Fprintf(os.Stderr, "  warning: configuring SSH key: %v\n", err)
		}

	case ghPkg.ProviderTypeApp:
		fmt.Println("Generating installation token...")
		token, err := ghPkg.GenerateInstallationToken(ctx, root, providerName, provider.AppID, repo)
		if err != nil {
			return fmt.Errorf("generating installation token: %w", err)
		}
		repoURL := ghPkg.HTTPSCloneURL(repo, token)
		if err := gitPkg.Clone(ctx, repoURL, repoDir, branch, ""); err != nil {
			return err
		}
		// Set remote to tokenless URL (token is short-lived, will be refreshed on fetch)
		if err := gitPkg.SetRemoteURL(ctx, repoDir, fmt.Sprintf("https://github.com/%s.git", repo)); err != nil {
			fmt.Fprintf(os.Stderr, "  warning: resetting remote URL: %v\n", err)
		}

	default:
		return fmt.Errorf("unknown provider type %q", provider.Type)
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

	appCfg, err := requireApp(cfg, appName)
	if err != nil {
		return err
	}

	root := jibRoot()

	// Paths that will be removed
	stateFile := filepath.Join(root, "state", appName+".json")
	domainStateFile := filepath.Join(root, "state", appName+".domains.json")
	secretsDir := filepath.Join(root, "secrets", appName)
	repoDirPath := repoDir(appName, appCfg.Repo)
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
		fmt.Printf("  - Remove repo: %s\n", repoDirPath)
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
	if _, statErr := os.Stat(repoDirPath); statErr == nil {
		if err := os.RemoveAll(repoDirPath); err != nil {
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
	if err := config.ModifyRawConfig(cfgPath, func(raw map[string]interface{}) error {
		if appsRaw, ok := raw["apps"]; ok {
			if appsMap, ok := appsRaw.(map[string]interface{}); ok {
				delete(appsMap, appName)
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("removing app from config: %w", err)
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
