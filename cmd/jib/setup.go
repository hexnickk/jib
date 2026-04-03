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
	"time"

	"github.com/google/uuid"
	"github.com/hexnickk/jib/internal/bus"
	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/docker"
	gitPkg "github.com/hexnickk/jib/internal/git"
	ghPkg "github.com/hexnickk/jib/internal/github"
	"github.com/hexnickk/jib/internal/module"
	"github.com/hexnickk/jib/internal/stack"
	"github.com/hexnickk/jib/internal/tui"
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
		Short: "Add app: config + clone + key + nginx",
		Args:  exactArgs(1),
		RunE:  runAdd,
	}
	addCmd.Flags().String("repo", "", "GitHub repo (org/name)")
	addCmd.Flags().String("git-provider", "", "Git auth provider name (from 'jib github key/app setup')")
	addCmd.Flags().String("ingress", "direct", "Default ingress for all domains: direct, cloudflare-tunnel (override per-domain with @suffix)")
	addCmd.Flags().String("compose", "", "Compose file path (or comma-separated list)")
	addCmd.Flags().StringSlice("domain", nil, "Domain mapping (repeatable): example.com, web=example.com, or example.com:8080. Omit to use jib.domain labels from compose.")
	addCmd.Flags().StringSlice("health", nil, "Health check path:port (repeatable). Inferred from compose if omitted.")
	addCmd.Flags().Bool("config-only", false, "Write config without provisioning")
	rootCmd.AddCommand(addCmd)

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

// systemd unit templates for jib services.
var serviceUnits = map[string]string{
	"jib-deployer": `[Unit]
Description=Jib Deployer
After=docker.service
Wants=docker.service

[Service]
ExecStartPre=/bin/sh -c 'until nc -z 127.0.0.1 4222; do sleep 1; done'
ExecStart=/usr/local/bin/jib-deployer
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`,
	"jib-watcher": `[Unit]
Description=Jib Git Watcher
After=jib-deployer.service
Wants=jib-deployer.service

[Service]
ExecStartPre=/bin/sh -c 'until nc -z 127.0.0.1 4222; do sleep 1; done'
ExecStart=/usr/local/bin/jib-watcher
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`,
	"jib-heartbeat": `[Unit]
Description=Jib Heartbeat
After=docker.service

[Service]
ExecStartPre=/bin/sh -c 'until nc -z 127.0.0.1 4222; do sleep 1; done'
ExecStart=/usr/local/bin/jib-heartbeat
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`,
}

func runInit(cmd *cobra.Command, args []string) error {
	skipInstall, _ := cmd.Flags().GetBool("skip-install")

	cfgPath := config.ConfigFile()
	root := config.Root()
	firstRun := !fileExists(cfgPath)

	if firstRun {
		fmt.Println("=== Jib Server Bootstrap ===")
	} else {
		fmt.Println("=== Jib Server Converge ===")
	}
	fmt.Println()

	// --- Ensure: dependencies installed ---
	if !skipInstall {
		// Enable and start Docker and Nginx
		for _, svc := range []string{"docker", "nginx"} {
			ensureSystemdService(svc)
		}
	} else {
		fmt.Println("Skipping dependency installation (--skip-install).")
	}

	// --- Ensure: jib group exists and current user is a member ---
	ensureJibGroup()

	// --- Ensure: current user can access Docker ---
	ensureDockerGroup()

	// --- Ensure: directory structure with correct ownership/permissions ---
	ensureDirs(root)

	// --- Ensure: jib source repo for Docker service builds ---
	ensureSourceRepo()

	// --- Ensure: config.yml exists ---
	if firstRun {
		fmt.Println("\nGenerating config.yml...")
		cfgContent := fmt.Sprintf("config_version: %d\npoll_interval: 5m\napps: {}\n", config.LatestConfigVersion)

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

	// --- Ensure: systemd units installed and running ---
	ensureServices()

	// --- Ensure: service stack (NATS + configured services) ---
	fmt.Println("\nEnsuring service stack...")
	syncStack()

	fmt.Println()
	fmt.Println("Jib initialized! Next:")
	fmt.Println("  jib add <app> --repo org/repo --domain example.com")
	fmt.Println("  jib deploy <app>")

	return nil
}

// userInGroup checks if a user belongs to a group (per /etc/group, not the active session).
func userInGroup(user, group string) bool {
	out, err := exec.Command("id", "-nG", user).Output() //nolint:gosec // trusted CLI subprocess
	if err != nil {
		return false
	}
	return strings.Contains(" "+strings.TrimSpace(string(out))+" ", " "+group+" ")
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// ensureSystemdService enables and starts a systemd service if not already active.
func ensureSystemdService(name string) {
	// Check if already active.
	if err := exec.Command("systemctl", "is-active", "--quiet", name).Run(); err == nil { //nolint:gosec // trusted CLI subprocess
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
		"nginx", "locks", "deploy-keys", "logs", "src",
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

// ensureSourceRepo clones or updates the jib source at /opt/jib/src for Docker service builds.
func ensureSourceRepo() {
	srcDir := config.RepoRoot()

	if version == "dev" {
		fmt.Println("\nSkipping source repo (dev build).")
		return
	}

	fmt.Println("\nEnsuring jib source...")

	gitDir := filepath.Join(srcDir, ".git")
	if _, err := os.Stat(gitDir); os.IsNotExist(err) {
		// Fresh clone at the specific tag (shallow).
		fmt.Printf("  Cloning jib source (%s)...\n", version)
		cmd := sudoCmd("git", "clone", "--depth", "1", "--branch", version,
			"https://github.com/hexnickk/jib.git", srcDir)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			fmt.Fprintf(os.Stderr, "  warning: clone failed: %v\n", err)
			return
		}
	} else {
		// Already cloned — update to current version if needed.
		out, err := exec.Command("git", "-C", srcDir, "describe", "--tags", "--exact-match", "HEAD").Output() //nolint:gosec // trusted path
		currentTag := strings.TrimSpace(string(out))
		if err != nil || currentTag != version {
			fmt.Printf("  Updating source to %s...\n", version)
			_ = sudoCmd("git", "-C", srcDir, "fetch", "--depth", "1", "origin", "tag", version).Run()
			_ = sudoCmd("git", "-C", srcDir, "checkout", version).Run()
		} else {
			fmt.Printf("  Source at %s: OK\n", version)
		}
	}

	// Fix ownership.
	_ = sudoCmd("chown", "-R", "root:jib", srcDir).Run()
}

// ensureServices installs, enables, and starts the jib systemd service units.
// Migrates from the old monolithic jib.service if it exists.
// Restarts already-running services to pick up new binaries.
func ensureServices() {
	fmt.Println("\nEnsuring jib services...")

	// Migrate from old monolithic daemon if present.
	oldUnit := "/etc/systemd/system/jib.service"
	if _, err := os.Stat(oldUnit); err == nil {
		fmt.Println("  Migrating from old jib.service...")
		_ = sudoCmd("systemctl", "stop", "jib").Run()
		_ = sudoCmd("systemctl", "disable", "jib").Run()
		_ = sudoCmd("rm", "-f", oldUnit).Run()
		fmt.Println("  Old jib.service removed.")
	}

	// Write unit files for services whose binaries exist.
	for name, unit := range serviceUnits {
		binaryPath := filepath.Join("/usr/local/bin", name)
		if _, err := os.Stat(binaryPath); os.IsNotExist(err) {
			fmt.Fprintf(os.Stderr, "  warning: %s not found, skipping\n", binaryPath)
			continue
		}

		unitPath := fmt.Sprintf("/etc/systemd/system/%s.service", name)
		writeCmd := sudoCmd("tee", unitPath)
		writeCmd.Stdin = strings.NewReader(unit)
		writeCmd.Stdout = nil
		if err := writeCmd.Run(); err != nil {
			fmt.Fprintf(os.Stderr, "  warning: could not write %s: %v\n", unitPath, err)
			continue
		}
	}

	if err := sudoCmd("systemctl", "daemon-reload").Run(); err != nil {
		fmt.Fprintf(os.Stderr, "  warning: systemctl daemon-reload: %v\n", err)
	}

	for name := range serviceUnits {
		binaryPath := filepath.Join("/usr/local/bin", name)
		if _, err := os.Stat(binaryPath); os.IsNotExist(err) {
			continue
		}

		wasRunning := exec.Command("systemctl", "is-active", "--quiet", name).Run() == nil //nolint:gosec // trusted CLI subprocess

		if wasRunning {
			// Restart to pick up new binary.
			if err := sudoCmd("systemctl", "restart", name).Run(); err != nil {
				fmt.Fprintf(os.Stderr, "  warning: restart %s: %v\n", name, err)
			} else {
				fmt.Printf("  %s: restarted\n", name)
			}
		} else {
			if err := sudoCmd("systemctl", "enable", "--now", name).Run(); err != nil {
				fmt.Fprintf(os.Stderr, "  warning: enable --now %s: %v\n", name, err)
			} else {
				fmt.Printf("  %s: started\n", name)
			}
		}
	}
}

// syncStack regenerates the service stack compose file from the current config
// and converges running containers. Creates tokens on first run.
// Call after any config change that affects services (notify add/remove,
// cloudflare setup, jib init, etc.).
func syncStack() {
	cfg, err := loadConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "  stack: warning: loading config: %v\n", err)
		return
	}

	tokensPath := filepath.Join(config.StackDir(), "tokens.json")
	var tokens *stack.Tokens
	if data, readErr := os.ReadFile(tokensPath); readErr == nil { //nolint:gosec // trusted path
		var t stack.Tokens
		if json.Unmarshal(data, &t) == nil && t.Daemon != "" {
			tokens = &t
		}
	}

	// Generate new tokens if needed (first run).
	if tokens == nil {
		t, genErr := stack.GenerateTokens()
		if genErr != nil {
			fmt.Fprintf(os.Stderr, "  stack: warning: generating NATS tokens: %v\n", genErr)
			return
		}
		tokens = t
		if tokenData, marshalErr := json.Marshal(tokens); marshalErr == nil {
			_ = os.WriteFile(tokensPath, tokenData, 0o600)
		}
	}

	// Collect module-contributed compose services.
	tokenMap := tokens.TokenMap()
	var moduleServices []string
	for _, cp := range module.ComposeProviders() {
		if svc := cp.ComposeServices(cfg, tokenMap); svc != "" {
			moduleServices = append(moduleServices, svc)
		}
	}

	if err := stack.EnsureStack(cfg, tokens, moduleServices); err != nil {
		fmt.Fprintf(os.Stderr, "  stack: warning: writing stack files: %v\n", err)
		return
	}

	ctx := context.Background()
	if err := stack.Up(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "  stack: warning: converging: %v\n", err)
	}
}

func runEdit(cmd *cobra.Command, args []string) error {
	editor := os.Getenv("EDITOR")
	if editor == "" {
		editor = os.Getenv("VISUAL")
	}
	if editor == "" {
		editor = "vi"
	}

	cfgPath := config.ConfigFile()

	// Check the file exists before editing
	if _, err := os.Stat(cfgPath); err != nil {
		return fmt.Errorf("config file not found at %s: %w", cfgPath, err)
	}

	editorCmd := exec.Command(editor, cfgPath) //nolint:gosec // trusted CLI subprocess
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

// pendingDomain tracks a domain being configured before compose parsing resolves all fields.
type pendingDomain struct {
	Host    string
	Port    int
	Service string // non-empty if using service=domain format
	Ingress string // per-domain ingress, overrides --ingress flag
}

// pendingToDomain converts a pendingDomain to a config.Domain, applying the fallback ingress.
func pendingToDomain(p pendingDomain, fallbackIngress string) config.Domain {
	ing := p.Ingress
	if ing == "" {
		ing = fallbackIngress
	}
	if ing == "direct" {
		ing = "" // normalize: empty = direct
	}
	return config.Domain{Host: p.Host, Port: p.Port, Ingress: ing}
}

func runAdd(cmd *cobra.Command, args []string) error {
	appName := args[0]

	repo, _ := cmd.Flags().GetString("repo")
	providerName, _ := cmd.Flags().GetString("git-provider")
	ingress, _ := cmd.Flags().GetString("ingress")
	composeFlag, _ := cmd.Flags().GetString("compose")
	domainFlags, _ := cmd.Flags().GetStringSlice("domain")
	healthFlags, _ := cmd.Flags().GetStringSlice("health")
	configOnly, _ := cmd.Flags().GetBool("config-only")

	if repo == "" && len(domainFlags) == 0 && tui.IsInteractive() {
		fmt.Println("Add a new app to jib.")
		fmt.Println()
		fmt.Println("You'll need:")
		fmt.Println("  1. A GitHub repo (org/name) containing a docker-compose.yml or Dockerfile")
		fmt.Println("  2. A domain pointed at this server (A/CNAME record)")
		fmt.Println("  3. A git provider (set up with 'jib github app setup' or 'jib github key setup')")
		fmt.Println()
		fmt.Println("Domain formats:")
		fmt.Println("  example.com                    single-service app (port auto-detected)")
		fmt.Println("  web=example.com                map domain to a specific compose service")
		fmt.Println("  example.com:8080               map domain to an explicit port")
		fmt.Println("  example.com@cloudflare-tunnel  specify ingress per domain")
		fmt.Println()
		fmt.Println("Or add jib.domain/jib.ingress labels to your docker-compose.yml")
		fmt.Println("services and omit --domain entirely.")
		fmt.Println()
	}

	if repo == "" {
		var err error
		repo, err = tui.PromptString("repo", "GitHub repo (org/name)")
		if err != nil {
			return err
		}
	}
	if len(domainFlags) == 0 {
		domain, err := tui.PromptStringOptional("Domain (leave empty to use jib.domain labels from compose)")
		if err != nil {
			return err
		}
		if domain != "" {
			domainFlags = []string{domain}
		}
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
	root := config.Root()
	repoDirPath := repoDir(appName, repo)

	// Parse compose files
	var composeFiles config.StringOrSlice
	if composeFlag != "" {
		composeFiles = strings.Split(composeFlag, ",")
	}

	// Parse domains. Supported formats:
	//   example.com                    — port inferred (single-service shortcut)
	//   example.com:8080               — explicit port
	//   web=example.com                — service name, port resolved from compose
	//   example.com@cloudflare-tunnel  — with ingress type
	//   web=example.com@tailscale      — service + ingress
	var pending []pendingDomain
	for _, d := range domainFlags {
		// Extract @ingress suffix first
		var domIngress string
		if idx := strings.LastIndex(d, "@"); idx > 0 {
			domIngress = d[idx+1:]
			d = d[:idx]
		}

		var pd pendingDomain
		if svc, host, ok := strings.Cut(d, "="); ok && !strings.Contains(svc, ".") {
			// service=domain format (svc won't contain dots, domains will)
			// Strip any trailing :port from host — service name already determines the port
			host, _, _ = strings.Cut(host, ":")
			pd = pendingDomain{Host: host, Service: svc}
		} else if host, portStr, ok := strings.Cut(d, ":"); ok {
			port, err := strconv.Atoi(portStr)
			if err != nil {
				return fmt.Errorf("invalid port in domain %q: %w", d, err)
			}
			pd = pendingDomain{Host: host, Port: port}
		} else {
			pd = pendingDomain{Host: d}
		}
		pd.Ingress = domIngress
		pending = append(pending, pd)
	}
	domainsFromFlags := len(pending) > 0

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
				providerName, err = tui.PromptString("git-provider", "Git provider name (from 'jib github key/app setup')")
				if err != nil {
					return err
				}
			}
		}
		if providerName != "" {
			cfg, err := loadConfig()
			if err != nil {
				return fmt.Errorf("loading config: %w", err)
			}
			p, ok := cfg.LookupProvider(providerName)
			if !ok {
				return fmt.Errorf("git provider %q not found (see 'jib github key setup' or 'jib github app setup')", providerName)
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

	// --- Step 2: Infer ports and health from compose/Dockerfile ---
	var domains []config.Domain
	if !configOnly {
		files := []string(composeFiles)
		if len(files) == 0 {
			files = []string{"docker-compose.yml"}
		}

		if docker.NeedsGeneratedCompose(repoDirPath, files) {
			// Dockerfile-only repo — generate compose and assign port
			fmt.Println("\nNo docker-compose.yml found, will generate from Dockerfile.")
			overrideDir := config.OverrideDir()
			composePath, hostPort, err := docker.GenerateComposeForDockerfile(appName, repoDirPath, overrideDir, 0)
			if err != nil {
				return fmt.Errorf("generating compose from Dockerfile: %w", err)
			}
			composeFiles = config.StringOrSlice{composePath}
			fmt.Printf("  Generated compose: %s (port %d)\n", composePath, hostPort)

			for _, p := range pending {
				if p.Port == 0 {
					p.Port = hostPort
				}
				domains = append(domains, pendingToDomain(p, ingress))
			}
		} else {
			// Has compose file — infer from it
			composeSvcs, _ := docker.ParseComposeServices(repoDirPath, files)
			inferredPath, inferredPort := docker.InferHealthAndPort(composeSvcs)
			inferredPorts := docker.InferPorts(composeSvcs)

			// If no --domain flags, check for jib.domain labels in compose
			if !domainsFromFlags {
				labeled := docker.ServicesWithDomainLabels(composeSvcs)
				for _, svc := range labeled {
					if svc.HostPort > 0 {
						pending = append(pending, pendingDomain{Host: svc.Domain, Port: svc.HostPort, Ingress: svc.Ingress})
						fmt.Printf("  Found jib.domain label: %s → %s (port %d)\n", svc.Name, svc.Domain, svc.HostPort)
					} else {
						fmt.Printf("  Warning: service %q has jib.domain=%s but no exposed port, skipping\n", svc.Name, svc.Domain)
					}
				}
			}

			// Resolve service names and fill missing ports
			singleService := len(inferredPorts) == 1
			for _, p := range pending {
				if p.Service != "" {
					// service=domain format — resolve port from compose
					svc, ok := docker.ServiceByName(composeSvcs, p.Service)
					if !ok {
						return fmt.Errorf("service %q not found in compose file", p.Service)
					}
					if svc.HostPort == 0 {
						return fmt.Errorf("service %q has no exposed port", p.Service)
					}
					p.Port = svc.HostPort
					fmt.Printf("  Resolved %s → port %d (service %s)\n", p.Host, svc.HostPort, p.Service)
				} else if p.Port == 0 {
					if singleService {
						p.Port = inferredPorts[0]
						fmt.Printf("  Inferred port %d for %s\n", p.Port, p.Host)
					} else if len(inferredPorts) > 0 {
						p.Port = inferredPorts[0]
						fmt.Printf("  Inferred port %d for %s (first exposed port — use service=domain for multi-service apps)\n", p.Port, p.Host)
					}
				}
				domains = append(domains, pendingToDomain(p, ingress))
			}

			if len(healthChecks) == 0 && inferredPort > 0 {
				healthChecks = []config.HealthCheck{{Path: inferredPath, Port: inferredPort}}
				fmt.Printf("  Inferred health check: %s:%d\n", inferredPath, inferredPort)
			}
		}
	} else {
		// config-only mode — no compose parsing, use pending as-is
		for _, p := range pending {
			domains = append(domains, pendingToDomain(p, ingress))
		}
	}

	// Check all domains have ports
	if len(domains) == 0 {
		return fmt.Errorf("no domains configured — use --domain or add jib.domain labels to your docker-compose.yml")
	}
	for _, d := range domains {
		if d.Port == 0 {
			return fmt.Errorf("could not determine port for domain %q — specify as domain:port or service=domain", d.Host)
		}
	}

	// --- Step 3: Save to config ---
	cfgPath := config.ConfigFile()

	if err := config.ModifyRawConfig(cfgPath, func(raw map[string]interface{}) error {
		newApp := config.App{
			Repo:     repo,
			Provider: providerName,
			Compose:  composeFiles,
			Domains:  domains,
			Health:   healthChecks,
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

	// --- Step 4: Deploy ---
	fmt.Println("\nDeploying...")

	b, err := connectNATS()
	if err != nil {
		return fmt.Errorf("connecting to NATS for deploy: %w", err)
	}
	defer b.Close()

	correlationID := uuid.NewString()
	deployCmd := bus.DeployCommand{
		Message: bus.NewMessage("cli"),
		App:     appName,
		Force:   true,
		Trigger: "add",
		User:    currentUser(),
	}
	deployCmd.CorrelationID = correlationID

	ev, err := b.DeployAndWait(deployCmd.Subject(), deployCmd, correlationID, appName, 5*time.Minute)
	if err != nil {
		return fmt.Errorf("deploy failed: %w", err)
	}
	if ev.Status != bus.StatusSuccess {
		return fmt.Errorf("deploy failed: %s", ev.Error)
	}

	sha := ev.SHA
	if len(sha) > 8 {
		sha = sha[:8]
	}
	fmt.Printf("\nApp %q deployed successfully (SHA: %s)\n", appName, sha)

	// --- Step 5: Run module setup hooks (nginx, cloudflare, etc.) ---
	appCfg := cfg.Apps[appName]
	for _, hook := range module.SetupHooks() {
		if err := hook.OnAppAdd(ctx, appName, appCfg, cfg); err != nil {
			fmt.Fprintf(os.Stderr, "  warning: %s: %v\n", hook.Name(), err)
		}
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
		token, err := ghPkg.GenerateInstallationToken(ctx, providerName, provider.AppID, repo)
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

	// Paths that will be removed
	stateFile := filepath.Join(config.StateDir(), appName+".json")
	domainStateFile := filepath.Join(config.StateDir(), appName+".domains.json")
	secretsDir := filepath.Join(config.SecretsDir(), appName)
	repoDirPath := repoDir(appName, appCfg.Repo)
	overrideFile := docker.OverridePath(config.OverrideDir(), appName)
	historyFile := filepath.Join(config.LogDir(), appName+".jsonl")

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
		ok, err := tui.PromptConfirm("Continue?", false)
		if err != nil {
			return err
		}
		if !ok {
			fmt.Println("Aborted.")
			return nil
		}
	}

	var removed []string
	ctx := context.Background()

	// 1. Docker compose down
	compose, err := newCompose(cfg, appName)
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: could not create compose handle: %v\n", err)
	} else {
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

	// 2. Run module teardown hooks (cloudflare routes, nginx configs, etc.)
	for _, hook := range module.SetupHooks() {
		if err := hook.OnAppRemove(ctx, appName, appCfg, cfg); err != nil {
			fmt.Fprintf(os.Stderr, "warning: %s teardown: %v\n", hook.Name(), err)
		} else {
			removed = append(removed, hook.Name())
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
	cfgPath := config.ConfigFile()
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
