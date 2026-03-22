package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"text/tabwriter"

	"github.com/hexnickk/jib/internal/platform"
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
		Args:  cobra.RangeArgs(1, 2),
		RunE:  runLogs,
	}
	logsCmd.Flags().BoolP("follow", "f", false, "Follow log output")
	logsCmd.Flags().Int("tail", 100, "Number of lines to show from the end")
	rootCmd.AddCommand(logsCmd)

	// jib history <app>
	historyCmd := &cobra.Command{
		Use:   "history <app>",
		Short: "Deploy/rollback/backup timeline",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("[history] Would show deploy/rollback/backup timeline for %q.\n", args[0])
			fmt.Println("  This requires a history log which is not yet implemented.")
			return nil
		},
	}
	historyCmd.Flags().Int("limit", 0, "Maximum number of entries to show (0 = all)")
	historyCmd.Flags().Bool("json", false, "Output in JSON format")
	rootCmd.AddCommand(historyCmd)

	// jib env <app>
	rootCmd.AddCommand(&cobra.Command{
		Use:   "env <app>",
		Short: "Show env vars (secrets redacted)",
		Args:  cobra.ExactArgs(1),
		RunE:  runEnv,
	})

	// jib apps
	rootCmd.AddCommand(&cobra.Command{
		Use:   "apps",
		Short: "List all apps with status summary",
		RunE:  runApps,
	})

	// jib doctor
	rootCmd.AddCommand(&cobra.Command{
		Use:   "doctor",
		Short: "Check everything: deps, nginx, docker, daemon, certs, secrets",
		RunE:  runDoctor,
	})

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
		if _, ok := cfg.Apps[appName]; !ok {
			return fmt.Errorf("app %q not found in config", appName)
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

	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(w, "APP\tSHA\tSTATUS\tLAST DEPLOY\tFAILURES\tPINNED")
	for _, s := range statuses {
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%d\t%v\n",
			s.Name, s.DeployedSHA, s.LastDeployStatus, s.LastDeploy,
			s.ConsecutiveFailures, s.Pinned)
	}
	w.Flush()
	return nil
}

func runApps(cmd *cobra.Command, args []string) error {
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	if len(cfg.Apps) == 0 {
		fmt.Println("No apps configured.")
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(w, "APP\tREPO\tBRANCH\tSTRATEGY\tDOMAINS")

	names := sortedAppNames(cfg.Apps)
	for _, name := range names {
		app := cfg.Apps[name]
		var domains []string
		for _, d := range app.Domains {
			domains = append(domains, fmt.Sprintf("%s:%d", d.Host, d.Port))
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n",
			name, app.Repo, app.Branch, app.Strategy, strings.Join(domains, ", "))
	}
	w.Flush()
	return nil
}

func runDoctor(cmd *cobra.Command, args []string) error {
	fmt.Println("=== Dependency Checks ===")
	depResults := platform.CheckAllDependencies()
	allOK := true
	for _, r := range depResults {
		status := "OK"
		detail := fmt.Sprintf("v%s", r.Version)
		if !r.Installed {
			status = "MISSING"
			detail = "not installed"
			allOK = false
		} else if !r.MeetsMinimum {
			status = "OLD"
			detail = fmt.Sprintf("v%s (need >= %s)", r.Version, r.MinVersion)
			allOK = false
		}
		fmt.Printf("  %-20s %s  %s\n", r.Name, status, detail)
	}

	// Check secrets for all apps
	cfg, cfgErr := loadConfig()
	if cfgErr != nil {
		fmt.Printf("\n=== Config ===\n")
		fmt.Printf("  FAIL  Could not load config: %v\n", cfgErr)
		allOK = false
	} else {
		fmt.Println("\n=== Secrets ===")
		mgr := newSecretsManager()
		secretStatuses := mgr.CheckAll(cfg.Apps)
		if len(secretStatuses) == 0 {
			fmt.Println("  No apps require secrets_env.")
		}
		for _, s := range secretStatuses {
			if s.Exists {
				fmt.Printf("  %-20s OK    %s\n", s.App, s.Path)
			} else {
				fmt.Printf("  %-20s MISSING  %s\n", s.App, s.Path)
				allOK = false
			}
		}

		// Check certs
		fmt.Println("\n=== SSL Certificates ===")
		sslMgr := newSSLManager(cfg)
		hasDomains := false
		for appName, app := range cfg.Apps {
			for _, d := range app.Domains {
				hasDomains = true
				if !sslMgr.CertExists(d.Host) {
					fmt.Printf("  %-30s MISSING  (app: %s)\n", d.Host, appName)
					allOK = false
				} else {
					days, err := sslMgr.CheckExpiry(d.Host)
					if err != nil {
						fmt.Printf("  %-30s ERROR    %v (app: %s)\n", d.Host, err, appName)
						allOK = false
					} else if days < 14 {
						fmt.Printf("  %-30s WARNING  %d days remaining (app: %s)\n", d.Host, days, appName)
					} else {
						fmt.Printf("  %-30s OK       %d days remaining (app: %s)\n", d.Host, days, appName)
					}
				}
			}
		}
		if !hasDomains {
			fmt.Println("  No domains configured.")
		}
	}

	fmt.Println()
	if allOK {
		fmt.Println("All checks passed.")
	} else {
		fmt.Println("Some checks failed. See above for details.")
	}
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

	appCfg, ok := cfg.Apps[appName]
	if !ok {
		return fmt.Errorf("app %q not found in config", appName)
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

func sortedAppNames[V any](apps map[string]V) []string {
	names := make([]string, 0, len(apps))
	for name := range apps {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
