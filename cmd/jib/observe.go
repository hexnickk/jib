package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
)

func registerObserveCommands(rootCmd *cobra.Command) {
	// jib status [app]
	statusCmd := &cobra.Command{
		Use:   "status [app]",
		Short: "Show status of all apps or a specific app",
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
		Short: "Deploy/rollback/backup timeline",
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

	// jib apps
	appsCmd := &cobra.Command{
		Use:   "apps",
		Short: "List all apps with status summary",
		RunE:  runApps,
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

	store := newStateStore()
	jsonOutput, _ := cmd.Flags().GetBool("json")

	// If a specific app is requested
	if len(args) == 1 {
		appName := args[0]
		if _, err := requireApp(cfg, appName); err != nil {
			return err
		}
		appState, err := store.Load(appName)
		if err != nil {
			return fmt.Errorf("loading state for %s: %w", appName, err)
		}

		if jsonOutput {
			data, err := json.MarshalIndent(appState, "", "  ")
			if err != nil {
				return err
			}
			fmt.Println(string(data))
			return nil
		}

		fmt.Printf("App:                  %s\n", appName)
		fmt.Printf("Strategy:             %s\n", appState.Strategy)
		fmt.Printf("Deployed SHA:         %s\n", appState.DeployedSHA)
		fmt.Printf("Previous SHA:         %s\n", appState.PreviousSHA)
		fmt.Printf("Pinned:               %v\n", appState.Pinned)
		if !appState.LastDeploy.IsZero() {
			fmt.Printf("Last Deploy:          %s\n", appState.LastDeploy.Format("2006-01-02 15:04:05"))
		}
		fmt.Printf("Last Deploy Status:   %s\n", appState.LastDeployStatus)
		if appState.LastDeployError != "" {
			fmt.Printf("Last Deploy Error:    %s\n", appState.LastDeployError)
		}
		fmt.Printf("Last Deploy Trigger:  %s\n", appState.LastDeployTrigger)
		fmt.Printf("Last Deploy User:     %s\n", appState.LastDeployUser)
		fmt.Printf("Consecutive Failures: %d\n", appState.ConsecutiveFailures)
		return nil
	}

	// All apps
	type appStatus struct {
		Name                string `json:"name"`
		DeployedSHA         string `json:"deployed_sha"`
		LastDeployStatus    string `json:"last_deploy_status"`
		LastDeploy          string `json:"last_deploy"`
		ConsecutiveFailures int    `json:"consecutive_failures"`
		Pinned              bool   `json:"pinned"`
		Maintenance         bool   `json:"maintenance"`
	}

	p := newProxy(cfg)
	maintenanceApps := p.MaintenanceStatus(cfg.Apps)

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
		_, inMaintenance := maintenanceApps[name]
		statuses = append(statuses, appStatus{
			Name:                name,
			DeployedSHA:         sha,
			LastDeployStatus:    appState.LastDeployStatus,
			LastDeploy:          lastDeploy,
			ConsecutiveFailures: appState.ConsecutiveFailures,
			Pinned:              appState.Pinned,
			Maintenance:         inMaintenance,
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

	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "APP\tSHA\tSTATUS\tLAST DEPLOY\tFAILURES\tPINNED")
	for _, s := range statuses {
		status := s.LastDeployStatus
		if s.Maintenance {
			status = "maintenance"
		}
		_, _ = fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%d\t%v\n",
			s.Name, s.DeployedSHA, status, s.LastDeploy,
			s.ConsecutiveFailures, s.Pinned)
	}
	_ = w.Flush()
	fmt.Println("\nRun 'jib apps' for config details (repo, domains, strategy)")
	return nil
}

func runApps(cmd *cobra.Command, args []string) error {
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	jsonOutput, _ := cmd.Flags().GetBool("json")

	if len(cfg.Apps) == 0 {
		if jsonOutput {
			fmt.Println("[]")
			return nil
		}
		fmt.Println("No apps configured.")
		return nil
	}

	type appInfo struct {
		Name     string   `json:"name"`
		Repo     string   `json:"repo"`
		Branch   string   `json:"branch"`
		Strategy string   `json:"strategy"`
		Domains  []string `json:"domains"`
	}

	names := sortedAppNames(cfg.Apps)

	if jsonOutput {
		var items []appInfo
		for _, name := range names {
			app := cfg.Apps[name]
			var domains []string
			for _, d := range app.Domains {
				domains = append(domains, fmt.Sprintf("%s:%d", d.Host, d.Port))
			}
			items = append(items, appInfo{
				Name:     name,
				Repo:     app.Repo,
				Branch:   app.Branch,
				Strategy: app.Strategy,
				Domains:  domains,
			})
		}
		data, err := json.MarshalIndent(items, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(data))
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "APP\tREPO\tBRANCH\tSTRATEGY\tDOMAINS")

	for _, name := range names {
		app := cfg.Apps[name]
		var domains []string
		for _, d := range app.Domains {
			domains = append(domains, fmt.Sprintf("%s:%d", d.Host, d.Port))
		}
		_, _ = fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n",
			name, app.Repo, app.Branch, app.Strategy, strings.Join(domains, ", "))
	}
	_ = w.Flush()
	fmt.Println("\nRun 'jib status' for deploy status (SHA, failures, last deploy)")
	return nil
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

	if !appCfg.SecretsEnv {
		fmt.Println("Note: enable secrets_env in config for this app to use these vars")
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

	if !appCfg.SecretsEnv {
		fmt.Println("Note: enable secrets_env in config for this app to use these vars")
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

func sortedAppNames[V any](apps map[string]V) []string {
	names := make([]string, 0, len(apps))
	for name := range apps {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
