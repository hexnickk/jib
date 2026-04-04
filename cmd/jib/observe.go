package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/hexnickk/jib/internal/config"
	ghPkg "github.com/hexnickk/jib/internal/github"
	"github.com/hexnickk/jib/internal/stack"
	"github.com/spf13/cobra"
)

func registerObserveCommands(rootCmd *cobra.Command) {
	// jib status [name]
	statusCmd := &cobra.Command{
		Use:   "status [name]",
		Short: "Show server overview, or detail for a specific app/provider",
		Args:  cobra.MaximumNArgs(1),
		RunE:  runStatus,
	}
	statusCmd.Flags().Bool("json", false, "Output in JSON format")
	rootCmd.AddCommand(statusCmd)

	// jib logs <app> [service]
	logsCmd := &cobra.Command{
		Use:   "logs <app> [service]",
		Short: "Show container logs",
		Args:  rangeArgs(1, 2),
		RunE:  runLogs,
	}
	logsCmd.Flags().BoolP("follow", "f", false, "Follow log output")
	logsCmd.Flags().Int("tail", 100, "Number of lines to show from the end")
	rootCmd.AddCommand(logsCmd)

	// jib history <app>
	historyCmd := &cobra.Command{
		Use:   "history <app>",
		Short: "Deploy/rollback timeline",
		Args:  exactArgs(1),
		RunE:  runHistory,
	}
	historyCmd.Flags().Int("limit", 20, "Maximum number of entries to show")
	historyCmd.Flags().Bool("json", false, "Output raw JSON lines")
	rootCmd.AddCommand(historyCmd)

	// jib env <app>
	envCmd := &cobra.Command{
		Use:   "env <app>",
		Short: "Show/manage individual environment variables",
		Long:  "Show/manage individual environment variables.\n\nFor bulk import from a file, use 'jib secrets set <app> --file .env'",
		Args:  exactArgs(1),
		RunE:  runEnv,
	}

	// jib env set <app> KEY=VALUE [KEY2=VALUE2 ...]
	envCmd.AddCommand(&cobra.Command{
		Use:   "set <app> KEY=VALUE [KEY2=VALUE2 ...]",
		Short: "Set individual env vars (KEY=VALUE pairs)",
		Args:  minimumArgs(2),
		RunE:  runEnvSet,
	})

	// jib env remove <app> KEY [KEY2 ...] (alias: del)
	envCmd.AddCommand(&cobra.Command{
		Use:     "remove <app> KEY [KEY2 ...]",
		Aliases: []string{"del"},
		Short:   "Remove individual env vars by key",
		Args:    minimumArgs(2),
		RunE:    runEnvDel,
	})

	rootCmd.AddCommand(envCmd)

	// jib apps (alias for jib status)
	appsCmd := &cobra.Command{
		Use:   "apps",
		Short: "Alias for 'jib status'",
		Args:  cobra.MaximumNArgs(1),
		RunE:  runStatus,
	}
	appsCmd.Flags().Bool("json", false, "Output in JSON format")
	rootCmd.AddCommand(appsCmd)

	// jib metrics [app] [service]
	metricsCmd := &cobra.Command{
		Use:   "metrics [app] [service]",
		Short: "Live container stats (cpu, mem, net)",
		Args:  cobra.MaximumNArgs(2),
		RunE:  runMetrics,
	}
	metricsCmd.Flags().Bool("watch", false, "Continuously update metrics")
	rootCmd.AddCommand(metricsCmd)
}

func runStatus(cmd *cobra.Command, args []string) error {
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	jsonOutput, _ := cmd.Flags().GetBool("json")

	// Detail view for a specific entity
	if len(args) == 1 {
		return runStatusDetail(cfg, args[0], jsonOutput)
	}

	// Overview: apps first, then infrastructure
	store := newStateStore()

	type appStatus struct {
		Name                string `json:"name"`
		DeployedSHA         string `json:"deployed_sha"`
		LastDeployStatus    string `json:"last_deploy_status"`
		LastDeploy          string `json:"last_deploy"`
		ConsecutiveFailures int    `json:"consecutive_failures"`
		Pinned              bool   `json:"pinned"`
	}

	var statuses []appStatus
	names := sortedAppNames(cfg.Apps)

	for _, name := range names {
		appState, err := store.Load(name)
		if err != nil {
			fmt.Fprintf(os.Stderr, "warning: could not load state for %s: %v\n", name, err)
			continue
		}
		sha := appState.DeployedSHA
		if len(sha) > 7 {
			sha = sha[:7]
		}
		lastDeploy := ""
		if !appState.LastDeploy.IsZero() {
			lastDeploy = appState.LastDeploy.Format("2006-01-02 15:04:05")
		}
		statuses = append(statuses, appStatus{
			Name:                name,
			DeployedSHA:         sha,
			LastDeployStatus:    appState.LastDeployStatus,
			LastDeploy:          lastDeploy,
			ConsecutiveFailures: appState.ConsecutiveFailures,
			Pinned:              appState.Pinned,
		})
	}

	if jsonOutput {
		data, err := json.MarshalIndent(statuses, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(data))
		return nil
	}

	// Apps table
	if len(statuses) > 0 {
		fmt.Println("Apps:")
		w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
		_, _ = fmt.Fprintln(w, "  NAME\tSHA\tSTATUS\tLAST DEPLOY\tFAILURES")
		for _, s := range statuses {
			status := s.LastDeployStatus
			if s.Pinned {
				status += " (pinned)"
			}
			_, _ = fmt.Fprintf(w, "  %s\t%s\t%s\t%s\t%d\n",
				s.Name, s.DeployedSHA, status, s.LastDeploy,
				s.ConsecutiveFailures)
		}
		_ = w.Flush()
	} else {
		fmt.Println("Apps:    (none) — run 'jib add <name>' to deploy an app")
	}

	fmt.Println()
	printInfraStatus(cfg)

	// Service stack status.
	fmt.Println()
	stackStatus, err := stack.Status(context.Background())
	if err == nil && stackStatus != "" {
		fmt.Println("Services:")
		// Indent each line.
		for _, line := range strings.Split(stackStatus, "\n") {
			fmt.Printf("  %s\n", line)
		}
	}

	return nil
}

// runStatusDetail shows detailed status for a named entity (app or provider).
func runStatusDetail(cfg *config.Config, name string, jsonOutput bool) error {
	// Try app first
	if appCfg, ok := cfg.Apps[name]; ok {
		store := newStateStore()
		appState, err := store.Load(name)
		if err != nil {
			return fmt.Errorf("loading state for %s: %w", name, err)
		}

		if jsonOutput {
			data, err := json.MarshalIndent(appState, "", "  ")
			if err != nil {
				return err
			}
			fmt.Println(string(data))
			return nil
		}

		fmt.Printf("App: %s\n\n", name)
		fmt.Printf("  Repo:               %s\n", appCfg.Repo)
		fmt.Printf("  Branch:             %s\n", appCfg.Branch)
		for _, d := range appCfg.Domains {
			ingress := "direct"
			if d.Ingress != "" {
				ingress = d.Ingress
			}
			fmt.Printf("  Domain:             %s:%d (%s)\n", d.Host, d.Port, ingress)
		}
		if appCfg.Provider != "" {
			fmt.Printf("  Provider:           %s\n", appCfg.Provider)
		}
		fmt.Println()
		fmt.Printf("  Deployed SHA:       %s\n", appState.DeployedSHA)
		fmt.Printf("  Previous SHA:       %s\n", appState.PreviousSHA)
		if !appState.LastDeploy.IsZero() {
			fmt.Printf("  Last Deploy:        %s\n", appState.LastDeploy.Format("2006-01-02 15:04:05"))
		}
		fmt.Printf("  Deploy Status:      %s\n", appState.LastDeployStatus)
		if appState.LastDeployError != "" {
			fmt.Printf("  Deploy Error:       %s\n", appState.LastDeployError)
		}
		fmt.Printf("  Deploy Trigger:     %s\n", appState.LastDeployTrigger)
		if appState.Pinned {
			fmt.Printf("  Pinned:             true\n")
		}
		if appState.ConsecutiveFailures > 0 {
			fmt.Printf("  Failures:           %d\n", appState.ConsecutiveFailures)
		}
		return nil
	}

	// Try provider
	root := config.Root()
	if p, ok := cfg.LookupProvider(name); ok {
		if jsonOutput {
			data, err := json.MarshalIndent(p, "", "  ")
			if err != nil {
				return err
			}
			fmt.Println(string(data))
			return nil
		}

		switch p.Type {
		case "app":
			fmt.Printf("Provider: %s (github app)\n\n", name)
			fmt.Printf("  App ID:             %d\n", p.AppID)
			pemPath := ghPkg.AppPEMPath(name)
			if _, err := os.Stat(pemPath); err == nil {
				fmt.Printf("  Private Key:        %s\n", pemPath)
			} else {
				fmt.Printf("  Private Key:        (missing!)\n")
			}
		case "key":
			fmt.Printf("Provider: %s (deploy key)\n\n", name)
			keyPath := ghPkg.KeyPath(root, name)
			if _, err := os.Stat(keyPath); err == nil {
				fmt.Printf("  Key Path:           %s\n", keyPath)
			} else {
				fmt.Printf("  Key Path:           (missing!)\n")
			}
		}

		// Show which apps use this provider
		var apps []string
		for appName, app := range cfg.Apps {
			if app.Provider == name {
				apps = append(apps, appName)
			}
		}
		sort.Strings(apps)
		if len(apps) > 0 {
			fmt.Printf("  Used by:            %s\n", strings.Join(apps, ", "))
		} else {
			fmt.Printf("  Used by:            (none)\n")
		}
		return nil
	}

	return fmt.Errorf("%q not found (not an app or provider)", name)
}

func runLogs(cmd *cobra.Command, args []string) error {
	appName := args[0]
	service := ""
	if len(args) > 1 {
		service = args[1]
	}

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	compose, err := newCompose(cfg, appName)
	if err != nil {
		return err
	}

	follow, _ := cmd.Flags().GetBool("follow")
	tail, _ := cmd.Flags().GetInt("tail")

	return compose.Logs(context.Background(), service, follow, tail)
}

func runEnv(cmd *cobra.Command, args []string) error {
	appName := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	appCfg, err := requireApp(cfg, appName)
	if err != nil {
		return err
	}

	mgr := newSecretsManager()
	lines, err := mgr.EnvRedacted(appName, appCfg.EnvFile)
	if err != nil {
		return fmt.Errorf("reading env for %s: %w", appName, err)
	}

	for _, line := range lines {
		fmt.Println(line)
	}
	return nil
}

func runMetrics(cmd *cobra.Command, args []string) error {
	if len(args) == 0 {
		// Show metrics for all apps
		cfg, err := loadConfig()
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}
		names := sortedAppNames(cfg.Apps)
		for _, name := range names {
			compose, err := newCompose(cfg, name)
			if err != nil {
				fmt.Fprintf(os.Stderr, "warning: skipping %s: %v\n", name, err)
				continue
			}
			output, err := compose.Stats(context.Background())
			if err != nil {
				fmt.Fprintf(os.Stderr, "warning: stats for %s: %v\n", name, err)
				continue
			}
			fmt.Printf("=== %s ===\n%s\n\n", name, output)
		}
		return nil
	}

	appName := args[0]
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	compose, err := newCompose(cfg, appName)
	if err != nil {
		return err
	}

	output, err := compose.Stats(context.Background())
	if err != nil {
		return fmt.Errorf("getting metrics: %w", err)
	}

	fmt.Println(output)
	return nil
}

func runEnvSet(cmd *cobra.Command, args []string) error {
	appName := args[0]
	pairs := args[1:]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	appCfg, err := requireApp(cfg, appName)
	if err != nil {
		return err
	}

	vars := make(map[string]string, len(pairs))
	for _, pair := range pairs {
		idx := strings.Index(pair, "=")
		if idx < 1 {
			return fmt.Errorf("invalid format %q: expected KEY=VALUE", pair)
		}
		vars[pair[:idx]] = pair[idx+1:]
	}

	mgr := newSecretsManager()
	if err := mgr.SetVar(appName, appCfg.EnvFile, vars); err != nil {
		return fmt.Errorf("setting env vars: %w", err)
	}

	for key := range vars {
		fmt.Printf("Set %s\n", key)
	}
	fmt.Println("Restart or redeploy to apply changes.")
	return nil
}

func runEnvDel(cmd *cobra.Command, args []string) error {
	appName := args[0]
	keys := args[1:]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	appCfg, err := requireApp(cfg, appName)
	if err != nil {
		return err
	}

	mgr := newSecretsManager()
	if err := mgr.DelVar(appName, appCfg.EnvFile, keys); err != nil {
		return fmt.Errorf("deleting env vars: %w", err)
	}

	for _, key := range keys {
		fmt.Printf("Deleted %s\n", key)
	}
	fmt.Println("Restart or redeploy to apply changes.")
	return nil
}

func runHistory(cmd *cobra.Command, args []string) error {
	appName := args[0]
	limit, _ := cmd.Flags().GetInt("limit")
	jsonOutput, _ := cmd.Flags().GetBool("json")

	logger := newHistoryLogger()
	events, err := logger.Read(appName, limit)
	if err != nil {
		return fmt.Errorf("reading history for %s: %w", appName, err)
	}

	if len(events) == 0 {
		fmt.Printf("No history for %s.\n", appName)
		return nil
	}

	if jsonOutput {
		for _, ev := range events {
			data, err := json.Marshal(ev)
			if err != nil {
				return err
			}
			fmt.Println(string(data))
		}
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "TIME\tTYPE\tSHA\tSTATUS\tUSER\tDURATION")
	for _, ev := range events {
		sha := ev.SHA
		if len(sha) > 7 {
			sha = sha[:7]
		}
		ts := ev.Timestamp.Local().Format(time.DateTime)
		dur := fmt.Sprintf("%dms", ev.DurationMs)
		if ev.DurationMs >= 1000 {
			dur = fmt.Sprintf("%.1fs", float64(ev.DurationMs)/1000)
		}
		status := ev.Status
		if ev.Error != "" {
			status = status + " (" + ev.Error + ")"
		}
		_, _ = fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\n",
			ts, ev.Type, sha, status, ev.User, dur)
	}
	_ = w.Flush()
	return nil
}

// printInfraStatus prints a summary of infrastructure setup.
func printInfraStatus(cfg *config.Config) {
	// Git providers
	if cfg.GitHub != nil && len(cfg.GitHub.Providers) > 0 {
		fmt.Println("Providers:")
		w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
		_, _ = fmt.Fprintln(w, "  NAME\tTYPE\tDETAIL")
		for _, name := range sortedAppNames(cfg.GitHub.Providers) {
			p := cfg.GitHub.Providers[name]
			switch p.Type {
			case "app":
				_, _ = fmt.Fprintf(w, "  %s\tgithub app\tid=%d\n", name, p.AppID)
			case "key":
				_, _ = fmt.Fprintf(w, "  %s\tdeploy key\t\n", name)
			}
		}
		_ = w.Flush()
	} else {
		fmt.Println("Providers: (none) — run 'jib github app setup' or 'jib github key setup'")
	}

	fmt.Println()

	// Tunnel / SSL / other infra as key-value pairs
	fmt.Println("Server:")

	// Tunnel
	if cfg.Tunnel != nil {
		label := cfg.Tunnel.Provider
		if id := cfg.Tunnel.TunnelID; id != "" {
			if len(id) > 8 {
				id = id[:8] + "..."
			}
			label += " (managed, " + id + ")"
		}
		svcName := map[string]string{"cloudflare": "cloudflared", "tailscale": "tailscaled"}
		if svc, ok := svcName[cfg.Tunnel.Provider]; ok {
			if isServiceRunning(svc) {
				label += " [running]"
			} else {
				label += " [not running]"
			}
		}
		fmt.Printf("  tunnel:          %s\n", label)
	}

	// If nothing is configured, give a hint
	if cfg.Tunnel == nil {
		fmt.Println("  (not configured) — run 'jib init' to set up")
	}
}

// isServiceRunning checks if a systemd service is active.
func isServiceRunning(service string) bool {
	err := exec.Command("systemctl", "is-active", "--quiet", service).Run() //nolint:gosec // trusted service name
	return err == nil
}

func sortedAppNames[V any](apps map[string]V) []string {
	names := make([]string, 0, len(apps))
	for name := range apps {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
