// Command jib-cloudflared is the installer for the jib-cloudflared.service
// systemd unit, which manages the cloudflared tunnel container as a oneshot
// wrapper around docker compose. Like jib-bus, this binary has no runtime
// component — systemd invokes docker compose directly via the unit file, so
// this binary exists only to own and install that unit.
//
// Subcommand protocol (see also jib-deployer, jib-watcher, jib-bus):
//
//	jib-cloudflared install    write unit file, daemon-reload, enable (requires root)
//	jib-cloudflared uninstall  disable, stop, remove unit, daemon-reload (requires root)
//	jib-cloudflared info       print JSON metadata to stdout
//	jib-cloudflared --version  print version
package main

import (
	_ "embed"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

//go:embed jib-cloudflared.service
var systemdUnit []byte

//go:embed docker-compose.yml
var composeFile []byte

var version = "dev"

const (
	serviceName        = "jib-cloudflared"
	serviceDescription = "Cloudflare tunnel (docker compose oneshot)"
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
