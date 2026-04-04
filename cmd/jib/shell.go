package main

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
)

// registerShellCommands wires up the per-app shell-access verbs: exec (into
// a running container) and run (ephemeral container for one-off tasks).
// Both use DisableFlagParsing so the raw argv reaches the handler — users
// pass a literal "--" to separate the target service from the command to
// run, which cobra's own flag parsing would otherwise eat.
func registerShellCommands(rootCmd *cobra.Command) {
	rootCmd.AddCommand(&cobra.Command{
		Use:                "exec <app> [service] -- <cmd>",
		Short:              "Execute command in running container",
		DisableFlagParsing: true,
		RunE:               runExec,
	})

	rootCmd.AddCommand(&cobra.Command{
		Use:                "run <app> <service> [-- <cmd>]",
		Short:              "Run a one-off command in a new container",
		DisableFlagParsing: true,
		RunE:               runRun,
	})
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
