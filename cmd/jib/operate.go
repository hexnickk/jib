package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/hexnickk/jib/internal/backup"
	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/docker"
	"github.com/hexnickk/jib/internal/tui"
	"github.com/hexnickk/jib/internal/util"
	"github.com/spf13/cobra"
)

func registerOperateCommands(rootCmd *cobra.Command) {
	// jib up <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "up <app>",
		Short: "Start existing containers without rebuilding or pulling",
		Args:  exactArgs(1),
		RunE:  runUp,
	})

	// jib down <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "down <app>",
		Short: "Stop containers without removing app from config",
		Long:  "Stop containers without removing app from config.\n\nTo bring the app back up without redeploying, use 'jib up <app>'.",
		Args:  exactArgs(1),
		RunE:  runDown,
	})

	// jib restart <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "restart <app>",
		Short: "Restart containers without redeploying",
		Args:  exactArgs(1),
		RunE:  runRestart,
	})

	// jib exec <app> [service] -- <cmd>
	execCmd := &cobra.Command{
		Use:                "exec <app> [service] -- <cmd>",
		Short:              "Execute command in running container",
		DisableFlagParsing: true,
		RunE:               runExec,
	}
	rootCmd.AddCommand(execCmd)

	// jib run <app> <service> [-- <cmd>]
	runCmd := &cobra.Command{
		Use:                "run <app> <service> [-- <cmd>]",
		Short:              "Run a one-off command in a new container",
		DisableFlagParsing: true,
		RunE:               runRun,
	}
	rootCmd.AddCommand(runCmd)

	// jib backup <app> / jib backup list <app>
	backupCmd := &cobra.Command{
		Use:   "backup <app>",
		Short: "Create a backup of app data",
		Args:  exactArgs(1),
		RunE:  runBackup,
	}
	backupListCmd := &cobra.Command{
		Use:   "list <app>",
		Short: "List available backups for an app",
		Args:  exactArgs(1),
		RunE:  runBackupList,
	}
	backupListCmd.Flags().Bool("json", false, "Output in JSON format")
	backupCmd.AddCommand(backupListCmd)
	backupCmd.AddCommand(newBackupDestCmd())
	rootCmd.AddCommand(backupCmd)

	// jib restore <app>
	restoreCmd := &cobra.Command{
		Use:   "restore <app>",
		Short: "Restore app data from a backup",
		Args:  exactArgs(1),
		RunE:  runRestore,
	}
	restoreCmd.Flags().String("from", "", "Timestamp to restore from (e.g. 20260325-040000)")
	restoreCmd.Flags().Bool("dry-run", false, "Download and verify without restoring")
	restoreCmd.Flags().Bool("force", false, "Skip confirmation prompt")
	rootCmd.AddCommand(restoreCmd)

	// jib cleanup
	cleanupCmd := &cobra.Command{
		Use:   "cleanup",
		Short: "Clean up old images, volumes, and build cache",
		RunE:  runCleanup,
	}
	cleanupCmd.Flags().Bool("dry-run", false, "Show what would be pruned without actually pruning")
	rootCmd.AddCommand(cleanupCmd)

	// jib secrets
	secretsCmd := &cobra.Command{
		Use:              "secrets",
		Short:            "Manage app secrets (bulk file import)",
		Long:             "Manage app secrets (bulk file import).\n\nFor individual variable management, use 'jib env set <app> KEY=VALUE'",
		TraverseChildren: true,
	}
	secretsSetCmd := &cobra.Command{
		Use:   "set <app>",
		Short: "Import env vars from a file (bulk replace)",
		Args:  exactArgs(1),
		RunE:  runSecretsSet,
	}
	secretsSetCmd.Flags().String("file", "", "Path to secrets file")
	_ = secretsSetCmd.MarkFlagRequired("file")
	secretsCmd.AddCommand(secretsSetCmd)
	secretsCmd.AddCommand(&cobra.Command{
		Use:   "check [app]",
		Short: "Verify secrets file exists for an app",
		Args:  cobra.MaximumNArgs(1),
		RunE:  runSecretsCheck,
	})
	rootCmd.AddCommand(secretsCmd)

	// jib cron <app> — stub, hidden until implemented
	cronCmd := &cobra.Command{
		Use:    "cron",
		Short:  "Manage scheduled tasks per app",
		Hidden: true,
	}
	cronCmd.AddCommand(&cobra.Command{
		Use:   "add <app>",
		Short: "Add a scheduled task for an app",
		Args:  exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("[cron add] Would add a scheduled task for app %q.\n", args[0])
			return nil
		},
	})
	cronCmd.AddCommand(&cobra.Command{
		Use:   "list <app>",
		Short: "List scheduled tasks for an app",
		Args:  exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("[cron list] Would list scheduled tasks for app %q.\n", args[0])
			return nil
		},
	})
	cronCmd.AddCommand(&cobra.Command{
		Use:   "remove <app>",
		Short: "Remove a scheduled task for an app",
		Args:  exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("[cron remove] Would remove a scheduled task for app %q.\n", args[0])
			return nil
		},
	})
	cronCmd.AddCommand(&cobra.Command{
		Use:   "run <app>",
		Short: "Run a scheduled task immediately",
		Args:  exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("[cron run] Would run a scheduled task for app %q immediately.\n", args[0])
			return nil
		},
	})
	rootCmd.AddCommand(cronCmd)

	// jib upgrade
	rootCmd.AddCommand(&cobra.Command{
		Use:   "upgrade",
		Short: "Self-update jib binary from GitHub Releases",
		Args:  cobra.NoArgs,
		RunE:  runUpgrade,
	})

	// jib maintenance
	maintenanceCmd := &cobra.Command{
		Use:   "maintenance",
		Short: "Manage maintenance mode for apps",
	}

	maintenanceOnCmd := &cobra.Command{
		Use:   "on <app>",
		Short: "Enable maintenance mode (serve 503 page)",
		Args:  exactArgs(1),
		RunE:  runMaintenanceOn,
	}
	maintenanceOnCmd.Flags().String("message", "", "Custom maintenance message")
	maintenanceCmd.AddCommand(maintenanceOnCmd)

	maintenanceCmd.AddCommand(&cobra.Command{
		Use:   "off <app>",
		Short: "Disable maintenance mode (restore normal config)",
		Args:  exactArgs(1),
		RunE:  runMaintenanceOff,
	})

	maintenanceCmd.AddCommand(&cobra.Command{
		Use:   "status",
		Short: "Show which apps are in maintenance mode",
		Args:  cobra.NoArgs,
		RunE:  runMaintenanceStatus,
	})

	rootCmd.AddCommand(maintenanceCmd)

	// jib nuke — stub, hidden until implemented
	nukeCmd := &cobra.Command{
		Use:    "nuke",
		Short:  "Remove everything jib-related from the machine",
		Hidden: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			force, _ := cmd.Flags().GetBool("force")
			fmt.Println("[nuke] Would remove everything jib-related from this machine:")
			fmt.Println("  - /opt/jib/ (config, state, repos, secrets)")
			fmt.Println("  - nginx configs in /etc/nginx/conf.d/")
			fmt.Println("  - systemd service units")
			fmt.Println("  - docker containers and images for all jib apps")
			if !force {
				fmt.Println("  Use --force to skip confirmation prompt.")
			}
			return nil
		},
	}
	nukeCmd.Flags().Bool("force", false, "Skip confirmation prompt")
	rootCmd.AddCommand(nukeCmd)
}

func runUp(cmd *cobra.Command, args []string) error {
	appName := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	compose, err := newCompose(cfg, appName)
	if err != nil {
		return err
	}

	if err := compose.Up(context.Background(), nil); err != nil {
		return fmt.Errorf("starting %s: %w", appName, err)
	}

	fmt.Printf("Started %s.\n", appName)
	return nil
}

func runDown(cmd *cobra.Command, args []string) error {
	appName := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	compose, err := newCompose(cfg, appName)
	if err != nil {
		return err
	}

	if err := compose.Down(context.Background()); err != nil {
		return fmt.Errorf("stopping %s: %w", appName, err)
	}

	fmt.Printf("Stopped %s.\n", appName)
	return nil
}

func runRestart(cmd *cobra.Command, args []string) error {
	appName := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	compose, err := newCompose(cfg, appName)
	if err != nil {
		return err
	}

	if err := compose.Restart(context.Background(), nil); err != nil {
		return fmt.Errorf("restarting %s: %w", appName, err)
	}

	fmt.Printf("Restarted %s.\n", appName)
	return nil
}

// parseExecArgs parses "jib exec <app> [service] -- <cmd...>" from raw args.
// Since DisableFlagParsing is true, we receive the full args slice.
func parseExecArgs(args []string) (appName, service string, cmdArgs []string, err error) {
	if len(args) == 0 {
		return "", "", nil, fmt.Errorf("missing app name\n\nUsage:\n  jib exec <app> [service] -- <cmd>")
	}

	appName = args[0]
	rest := args[1:]

	// Find "--" separator
	dashIdx := -1
	for i, a := range rest {
		if a == "--" {
			dashIdx = i
			break
		}
	}

	if dashIdx == -1 {
		// No "--", treat everything after app as command (service defaults to first)
		if len(rest) == 0 {
			return "", "", nil, fmt.Errorf("command is required after app name\n\nUsage:\n  jib exec <app> [service] -- <cmd>")
		}
		// If only one arg after app, it could be service name or command
		// Convention: if there's no --, first arg is service, rest is command
		service = rest[0]
		cmdArgs = rest[1:]
		return appName, service, cmdArgs, nil
	}

	// Has "--" separator
	beforeDash := rest[:dashIdx]
	afterDash := rest[dashIdx+1:]

	if len(beforeDash) > 0 {
		service = beforeDash[0]
	}
	cmdArgs = afterDash

	return appName, service, cmdArgs, nil
}

func runExec(cmd *cobra.Command, args []string) error {
	// DisableFlagParsing is true, so we must handle --help manually.
	for _, a := range args {
		if a == "--help" || a == "-h" {
			return cmd.Help()
		}
	}

	appName, service, cmdArgs, err := parseExecArgs(args)
	if err != nil {
		return err
	}

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	compose, err := newCompose(cfg, appName)
	if err != nil {
		return err
	}

	return compose.Exec(context.Background(), service, cmdArgs)
}

// parseRunArgs parses "jib run <app> <service> [-- <cmd...>]" from raw args.
func parseRunArgs(args []string) (appName, service string, cmdArgs []string, err error) {
	if len(args) < 2 {
		return "", "", nil, fmt.Errorf("app name and service are required\n\nUsage:\n  jib run <app> <service> [-- <cmd>]")
	}

	appName = args[0]
	service = args[1]
	rest := args[2:]

	// Find "--" separator
	dashIdx := -1
	for i, a := range rest {
		if a == "--" {
			dashIdx = i
			break
		}
	}

	if dashIdx == -1 {
		cmdArgs = rest
	} else {
		cmdArgs = rest[dashIdx+1:]
	}

	return appName, service, cmdArgs, nil
}

func runRun(cmd *cobra.Command, args []string) error {
	// DisableFlagParsing is true, so we must handle --help manually.
	for _, a := range args {
		if a == "--help" || a == "-h" {
			return cmd.Help()
		}
	}

	appName, service, cmdArgs, err := parseRunArgs(args)
	if err != nil {
		return err
	}

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	compose, err := newCompose(cfg, appName)
	if err != nil {
		return err
	}

	return compose.Run(context.Background(), service, cmdArgs)
}

func runCleanup(cmd *cobra.Command, args []string) error {
	dryRun, _ := cmd.Flags().GetBool("dry-run")

	if dryRun {
		fmt.Println("Dry run: showing reclaimable space (nothing will be deleted).")
		fmt.Println()
		out, err := exec.CommandContext(context.Background(), "docker", "system", "df").CombinedOutput() //nolint:gosec // trusted CLI subprocess
		if err != nil {
			return fmt.Errorf("docker system df failed: %w", err)
		}
		fmt.Print(string(out))
		return nil
	}

	fmt.Println("Pruning unused Docker images...")
	if err := docker.PruneImages(context.Background()); err != nil {
		return fmt.Errorf("cleanup failed: %w", err)
	}
	fmt.Println("Done.")
	return nil
}

func runSecretsSet(cmd *cobra.Command, args []string) error {
	appName := args[0]
	filePath, _ := cmd.Flags().GetString("file")

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	appCfg, err := requireApp(cfg, appName)
	if err != nil {
		return err
	}

	mgr := newSecretsManager()
	if err := mgr.Set(appName, filePath, appCfg.EnvFile); err != nil {
		return fmt.Errorf("setting secrets for %s: %w", appName, err)
	}

	fmt.Printf("Secrets set for %s.\n", appName)
	return nil
}

func runSecretsCheck(cmd *cobra.Command, args []string) error {
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	mgr := newSecretsManager()

	if len(args) == 1 {
		// Check a single app
		appName := args[0]
		appCfg, err := requireApp(cfg, appName)
		if err != nil {
			return err
		}
		if !appCfg.SecretsEnv {
			fmt.Printf("App %q does not use secrets_env.\n", appName)
			return nil
		}
		exists, path := mgr.Check(appName, appCfg.EnvFile)
		if exists {
			fmt.Printf("OK  %s  %s\n", appName, path)
		} else {
			fmt.Printf("MISSING  %s  %s\n", appName, path)
			return fmt.Errorf("secrets file missing for %s", appName)
		}
		return nil
	}

	// Check all apps
	results := mgr.CheckAll(cfg.Apps)
	if len(results) == 0 {
		fmt.Println("No apps require secrets_env.")
		return nil
	}

	allOK := true
	for _, r := range results {
		if r.Exists {
			fmt.Printf("OK       %s  %s\n", r.App, r.Path)
		} else {
			fmt.Printf("MISSING  %s  %s\n", r.App, r.Path)
			allOK = false
		}
	}

	if !allOK {
		return fmt.Errorf("some secrets files are missing")
	}
	return nil
}

func runMaintenanceOn(cmd *cobra.Command, args []string) error {
	appName := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	appCfg, err := requireApp(cfg, appName)
	if err != nil {
		return err
	}

	if len(appCfg.Domains) == 0 {
		return fmt.Errorf("app %q has no domains configured", appName)
	}

	message, _ := cmd.Flags().GetString("message")

	p := newProxy(cfg)
	if err := p.MaintenanceOn(appName, appCfg.Domains, message); err != nil {
		return fmt.Errorf("enabling maintenance mode: %w", err)
	}

	fmt.Printf("Maintenance mode enabled for %s.\n", appName)
	for _, d := range appCfg.Domains {
		fmt.Printf("  %s -> 503 maintenance page\n", d.Host)
	}
	fmt.Println("Run `jib maintenance off " + appName + "` to restore normal operation.")
	return nil
}

func runMaintenanceOff(cmd *cobra.Command, args []string) error {
	appName := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	appCfg, err := requireApp(cfg, appName)
	if err != nil {
		return err
	}

	if len(appCfg.Domains) == 0 {
		return fmt.Errorf("app %q has no domains configured", appName)
	}

	p := newProxy(cfg)
	if err := p.MaintenanceOff(appName, appCfg.Domains); err != nil {
		return fmt.Errorf("disabling maintenance mode: %w", err)
	}

	fmt.Printf("Maintenance mode disabled for %s. Normal operation restored.\n", appName)
	return nil
}

func runMaintenanceStatus(cmd *cobra.Command, args []string) error {
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	p := newProxy(cfg)
	status := p.MaintenanceStatus(cfg.Apps)

	if len(status) == 0 {
		fmt.Println("No apps are in maintenance mode.")
		return nil
	}

	for app, domains := range status {
		fmt.Printf("%s: maintenance\n", app)
		for _, d := range domains {
			fmt.Printf("  %s\n", d)
		}
	}
	return nil
}

// githubRelease represents the relevant fields from the GitHub Releases API.
type githubRelease struct {
	TagName string `json:"tag_name"`
}

const (
	upgradeRepoAPI = "https://api.github.com/repos/hexnickk/jib/releases/latest"
	upgradeRepoURL = "https://github.com/hexnickk/jib/releases/download"
)

func runUpgrade(cmd *cobra.Command, args []string) error {
	currentVersion := version

	// 1. Fetch latest release tag from GitHub
	fmt.Println("Checking for updates...")

	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("GET", upgradeRepoAPI, nil)
	if err != nil {
		return fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "jib/"+currentVersion)

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("checking for updates failed (network error): %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode == 404 {
		return fmt.Errorf("no releases found — the project may not have published any releases yet")
	}
	if resp.StatusCode != 200 {
		var errResp struct{ Message string }
		if json.Unmarshal(body, &errResp) == nil && errResp.Message != "" {
			return fmt.Errorf("GitHub API error (%d): %s", resp.StatusCode, errResp.Message)
		}
		return fmt.Errorf("GitHub API returned status %d", resp.StatusCode)
	}

	var release githubRelease
	if err := json.Unmarshal(body, &release); err != nil {
		return fmt.Errorf("parsing release info: %w", err)
	}

	if release.TagName == "" {
		return fmt.Errorf("no release tag found in API response")
	}

	latestTag := release.TagName
	// Normalize: strip leading "v" for comparison
	latestClean := strings.TrimPrefix(latestTag, "v")
	currentClean := strings.TrimPrefix(currentVersion, "v")

	// 2. Compare versions
	if currentClean == latestClean {
		fmt.Printf("Already up to date (%s).\n", latestTag)
		return nil
	}

	fmt.Printf("Current version: %s\n", currentVersion)
	fmt.Printf("Latest version:  %s\n", latestTag)

	// 3. Detect OS/arch
	goos := runtime.GOOS
	goarch := runtime.GOARCH
	binaryName := fmt.Sprintf("jib-%s-%s", goos, goarch)
	downloadURL := fmt.Sprintf("%s/%s/%s", upgradeRepoURL, latestTag, binaryName)

	fmt.Printf("Downloading %s...\n", downloadURL)

	// 4. Download binary to temp file
	dlClient := &http.Client{Timeout: 5 * time.Minute}
	dlResp, err := dlClient.Get(downloadURL)
	if err != nil {
		return fmt.Errorf("downloading binary (network error): %w", err)
	}
	defer func() { _ = dlResp.Body.Close() }()

	if dlResp.StatusCode == 404 {
		return fmt.Errorf("binary not found for %s/%s at %s — this platform may not be supported", goos, goarch, latestTag)
	}
	if dlResp.StatusCode != 200 {
		return fmt.Errorf("download failed with status %d", dlResp.StatusCode)
	}

	tmpFile, err := os.CreateTemp("", "jib-upgrade-*")
	if err != nil {
		return fmt.Errorf("creating temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	removeTmp := true
	defer func() {
		if removeTmp {
			_ = os.Remove(tmpPath)
		}
	}()

	if _, err := io.Copy(tmpFile, dlResp.Body); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("writing binary to temp file: %w", err)
	}
	_ = tmpFile.Close()

	// 5. Make executable
	if err := os.Chmod(tmpPath, 0o755); err != nil { //nolint:gosec // binary must be executable
		return fmt.Errorf("making binary executable: %w", err)
	}

	// 6. Verify: run <tmp>/jib version
	verifyCmd := exec.Command(tmpPath, "--version") //nolint:gosec // trusted CLI subprocess
	verifyOut, err := verifyCmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("verification failed — downloaded binary does not run correctly: %w\nOutput: %s", err, string(verifyOut))
	}
	fmt.Printf("Verified: %s", string(verifyOut))

	// 7. Get current binary path
	currentBinary, err := os.Executable()
	if err != nil {
		return fmt.Errorf("finding current binary path: %w", err)
	}
	currentBinary, err = filepath.EvalSymlinks(currentBinary)
	if err != nil {
		return fmt.Errorf("resolving binary path: %w", err)
	}

	// 8. Replace current binary
	if err := os.Rename(tmpPath, currentBinary); err != nil {
		if os.IsPermission(err) {
			return fmt.Errorf("permission denied replacing %s — try running: sudo jib upgrade", currentBinary)
		}
		// On cross-device rename, fall back to copy
		if strings.Contains(err.Error(), "cross-device") || strings.Contains(err.Error(), "invalid cross-device link") {
			if copyErr := util.CopyFile(tmpPath, currentBinary); copyErr != nil {
				if os.IsPermission(copyErr) {
					return fmt.Errorf("permission denied replacing %s — try running: sudo jib upgrade", currentBinary)
				}
				return fmt.Errorf("replacing binary: %w", copyErr)
			}
		} else {
			return fmt.Errorf("replacing binary: %w", err)
		}
	}
	removeTmp = false // rename/copy succeeded; temp file is gone or consumed

	fmt.Printf("Upgraded jib from %s to %s\n", currentVersion, latestTag)
	return nil
}

func newBackupManager(cfg *config.Config) *backup.Manager {
	return backup.NewManager(cfg, filepath.Join(jibRoot(), "backups"))
}

func runBackup(cmd *cobra.Command, args []string) error {
	appName := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	appCfg, err := requireApp(cfg, appName)
	if err != nil {
		return err
	}

	mgr := newBackupManager(cfg)
	fmt.Printf("Backing up %s...\n", appName)

	result, err := mgr.Backup(appName, appCfg)
	if err != nil {
		return fmt.Errorf("backup failed: %w", err)
	}

	fmt.Printf("\nBackup complete:\n")
	fmt.Printf("  App:       %s\n", result.App)
	fmt.Printf("  Timestamp: %s\n", result.Timestamp)
	fmt.Printf("  Archive:   %s\n", result.ArchivePath)
	fmt.Printf("  Size:      %s\n", backup.HumanSize(result.ArchiveSize))
	fmt.Printf("  SHA256:    %s\n", result.SHA256)
	fmt.Printf("  Volumes:   %s\n", strings.Join(result.Volumes, ", "))
	if len(result.Uploaded) > 0 {
		fmt.Printf("  Uploaded:  %s\n", strings.Join(result.Uploaded, ", "))
	}
	return nil
}

func runBackupList(cmd *cobra.Command, args []string) error {
	appName := args[0]
	jsonOutput, _ := cmd.Flags().GetBool("json")

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	mgr := newBackupManager(cfg)
	backups, err := mgr.List(appName)
	if err != nil {
		return fmt.Errorf("listing backups: %w", err)
	}

	if len(backups) == 0 {
		if jsonOutput {
			fmt.Println("[]")
			return nil
		}
		fmt.Printf("No backups found for %s.\n", appName)
		return nil
	}

	if jsonOutput {
		data, err := json.MarshalIndent(backups, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(data))
		return nil
	}

	fmt.Printf("Backups for %s:\n\n", appName)
	fmt.Printf("  %-20s  %-40s  %s\n", "TIMESTAMP", "FILENAME", "DESTINATION")
	fmt.Printf("  %-20s  %-40s  %s\n", "---------", "--------", "-----------")
	for _, b := range backups {
		fmt.Printf("  %-20s  %-40s  %s\n", b.Timestamp, b.Filename, b.Destination)
	}
	return nil
}

func runRestore(cmd *cobra.Command, args []string) error {
	appName := args[0]
	from, _ := cmd.Flags().GetString("from")
	dryRun, _ := cmd.Flags().GetBool("dry-run")
	force, _ := cmd.Flags().GetBool("force")

	if from == "" {
		return fmt.Errorf("--from <timestamp> is required (use 'jib backup list %s' to see available backups)", appName)
	}

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	if _, err := requireApp(cfg, appName); err != nil {
		return err
	}

	if !dryRun && !force {
		fmt.Printf("This will restore %s from backup %s.\n", appName, from)
		fmt.Printf("Containers will be stopped and volume data will be overwritten.\n")
		ok, err := tui.PromptConfirm("Continue?", false)
		if err != nil {
			return err
		}
		if !ok {
			fmt.Println("Aborted.")
			return nil
		}
	}

	mgr := newBackupManager(cfg)
	fmt.Printf("Restoring %s from %s...\n", appName, from)

	if err := mgr.Restore(appName, from, dryRun); err != nil {
		return fmt.Errorf("restore failed: %w", err)
	}

	return nil
}
