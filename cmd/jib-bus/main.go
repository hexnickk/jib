// Command jib-bus is the installer for the jib-bus.service systemd unit,
// which manages the NATS message bus container as a oneshot wrapper around
// docker compose. Unlike jib-deployer and jib-watcher, jib-bus has no runtime
// component — systemd invokes docker compose directly via the unit file, so
// this binary exists only to own and install that unit.
//
// Subcommand protocol (see also jib-deployer, jib-watcher):
//
//	jib-bus install    write unit file, daemon-reload, enable (requires root)
//	jib-bus uninstall  disable, stop, remove unit, daemon-reload (requires root)
//	jib-bus info       print JSON metadata to stdout
//	jib-bus --version  print version
package main

import (
	_ "embed"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

//go:embed jib-bus.service
var systemdUnit []byte

//go:embed docker-compose.yml
var composeFile []byte

//go:embed nats.conf
var natsConf []byte

var version = "dev"

const (
	serviceName        = "jib-bus"
	serviceDescription = "NATS message bus (docker compose oneshot)"
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
