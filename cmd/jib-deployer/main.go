// Command jib-deployer handles deploys, rollbacks, and resumes via NATS.
//
// Subcommand protocol (see also jib-watcher):
//
//	jib-deployer run        run the service (systemd ExecStart)
//	jib-deployer install    write unit file, daemon-reload, enable (requires root)
//	jib-deployer uninstall  disable, stop, remove unit, daemon-reload (requires root)
//	jib-deployer info       print JSON metadata to stdout
//	jib-deployer --version  print version
package main

import (
	_ "embed"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

//go:embed jib-deployer.service
var systemdUnit []byte

var version = "dev"

const (
	serviceName        = "jib-deployer"
	serviceDescription = "handles deploys, rollbacks, and resumes via NATS"
)

func main() {
	root := &cobra.Command{
		Use:           serviceName,
		Short:         serviceDescription,
		Version:       version,
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	root.AddCommand(
		&cobra.Command{
			Use:   "run",
			Short: "Run the service in the foreground (systemd ExecStart)",
			Run:   func(*cobra.Command, []string) { runService() },
		},
		&cobra.Command{
			Use:   "install",
			Short: "Write unit file, daemon-reload, enable (requires root)",
			RunE:  func(*cobra.Command, []string) error { return installService() },
		},
		&cobra.Command{
			Use:   "uninstall",
			Short: "Disable, stop, remove unit, daemon-reload (requires root)",
			RunE:  func(*cobra.Command, []string) error { return uninstallService() },
		},
		&cobra.Command{
			Use:   "info",
			Short: "Print service metadata as JSON for discovery",
			Run:   func(*cobra.Command, []string) { printInfo() },
		},
	)

	if err := root.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
