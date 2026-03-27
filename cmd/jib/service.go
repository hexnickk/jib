package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/hexnickk/jib/internal/service"
	"github.com/spf13/cobra"
)

func registerServiceCommands(rootCmd *cobra.Command) {
	serviceCmd := &cobra.Command{
		Use:   "service",
		Short: "Manage shared services (databases, caches)",
		Long: `Manage standalone shared services (postgres, mysql, redis, mongodb, mariadb).
Services run on the jib-shared Docker network and can be accessed by any app.`,
	}

	// jib service add <type> --name <name> [--version <ver>]
	addCmd := &cobra.Command{
		Use:   "add <type>",
		Short: "Add a shared service",
		Long:  "Add a shared service. Supported types: " + strings.Join(service.SupportedTypes(), ", "),
		Args:  exactArgs(1),
		RunE:  runServiceAdd,
	}
	addCmd.Flags().String("name", "", "Name for the service (required)")
	addCmd.Flags().String("version", "", "Image version/tag (e.g. 16, 8, 7-alpine)")
	_ = addCmd.MarkFlagRequired("name")
	serviceCmd.AddCommand(addCmd)

	// jib service list
	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List all shared services",
		RunE:  runServiceList,
	}
	listCmd.Flags().Bool("json", false, "Output in JSON format")
	serviceCmd.AddCommand(listCmd)

	// jib service status <name>
	statusCmd := &cobra.Command{
		Use:   "status <name>",
		Short: "Show detailed status of a shared service",
		Args:  exactArgs(1),
		RunE:  runServiceStatus,
	}
	serviceCmd.AddCommand(statusCmd)

	// jib service remove <name> [--volumes]
	removeCmd := &cobra.Command{
		Use:   "remove <name>",
		Short: "Stop and remove a shared service",
		Args:  exactArgs(1),
		RunE:  runServiceRemove,
	}
	removeCmd.Flags().Bool("volumes", false, "Also remove data volumes")
	serviceCmd.AddCommand(removeCmd)

	rootCmd.AddCommand(serviceCmd)
}

func newServiceManager() *service.Manager {
	return service.NewManager(jibRoot())
}

func runServiceAdd(cmd *cobra.Command, args []string) error {
	serviceType := args[0]
	name, _ := cmd.Flags().GetString("name")
	version, _ := cmd.Flags().GetString("version")

	if !service.IsSupported(serviceType) {
		return fmt.Errorf("unsupported service type %q; supported: %s", serviceType, strings.Join(service.SupportedTypes(), ", "))
	}

	mgr := newServiceManager()

	fmt.Printf("Creating %s service %q...\n", serviceType, name)

	info, err := mgr.Add(name, serviceType, version)
	if err != nil {
		return fmt.Errorf("adding service: %w", err)
	}

	fmt.Printf("\nService %q created successfully!\n", name)
	fmt.Printf("  Type:    %s\n", info.Type)
	fmt.Printf("  Version: %s\n", info.Version)
	fmt.Printf("  Port:    %d\n", info.Port)
	fmt.Printf("  Network: jib-shared\n")

	if info.ConnString != "" {
		fmt.Printf("\nConnection string:\n  %s\n", info.ConnString)
	}

	fmt.Printf("\nCredentials stored at: %s\n", mgr.SecretsDir+"/"+name+".env")
	fmt.Printf("\nTo connect from an app, add to its docker-compose.yml:\n")
	fmt.Printf("  networks:\n")
	fmt.Printf("    jib-shared:\n")
	fmt.Printf("      external: true\n")

	return nil
}

func runServiceList(cmd *cobra.Command, args []string) error {
	jsonOutput, _ := cmd.Flags().GetBool("json")
	mgr := newServiceManager()

	services, err := mgr.List()
	if err != nil {
		return fmt.Errorf("listing services: %w", err)
	}

	if len(services) == 0 {
		if jsonOutput {
			fmt.Println("[]")
			return nil
		}
		fmt.Println("No shared services.")
		return nil
	}

	if jsonOutput {
		data, err := json.MarshalIndent(services, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(data))
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "NAME\tTYPE\tVERSION\tSTATUS\tHEALTH\tPORT")
	for _, svc := range services {
		health := svc.Health
		if health == "" {
			health = "-"
		}
		version := svc.Version
		if version == "" {
			version = "-"
		}
		portStr := "-"
		if svc.Port > 0 {
			portStr = fmt.Sprintf("%d", svc.Port)
		}
		_, _ = fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\n",
			svc.Name, svc.Type, version, svc.Status, health, portStr)
	}
	_ = w.Flush()
	return nil
}

func runServiceStatus(cmd *cobra.Command, args []string) error {
	name := args[0]
	mgr := newServiceManager()

	info, err := mgr.Status(name)
	if err != nil {
		return fmt.Errorf("getting service status: %w", err)
	}

	fmt.Printf("Name:       %s\n", info.Name)
	fmt.Printf("Type:       %s\n", info.Type)
	fmt.Printf("Version:    %s\n", info.Version)
	fmt.Printf("Status:     %s\n", info.Status)
	if info.Health != "" {
		fmt.Printf("Health:     %s\n", info.Health)
	}
	if info.Uptime != "" {
		fmt.Printf("Uptime:     %s\n", info.Uptime)
	}
	fmt.Printf("Port:       %d\n", info.Port)
	fmt.Printf("Network:    jib-shared\n")

	if info.ConnString != "" {
		fmt.Printf("\nConnection string:\n  %s\n", info.ConnString)
	}

	return nil
}

func runServiceRemove(cmd *cobra.Command, args []string) error {
	name := args[0]
	volumes, _ := cmd.Flags().GetBool("volumes")

	mgr := newServiceManager()

	fmt.Printf("Removing service %q...\n", name)
	if volumes {
		fmt.Println("  (including data volumes)")
	}

	if err := mgr.Remove(name, volumes); err != nil {
		return fmt.Errorf("removing service: %w", err)
	}

	fmt.Printf("Service %q removed.\n", name)
	return nil
}
