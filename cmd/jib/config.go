package main

import (
	"fmt"
	"os"
	"path"
	"strings"

	"github.com/hexnickk/jib/internal/backup"
	"github.com/hexnickk/jib/internal/config"
	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

func registerConfigCommands(rootCmd *cobra.Command) {
	// jib config
	configCmd := &cobra.Command{
		Use:   "config",
		Short: "Read and write jib configuration",
	}
	configCmd.AddCommand(&cobra.Command{
		Use:   "get <key>",
		Short: "Read a config value",
		Args:  exactArgs(1),
		RunE:  runConfigGet,
	})
	configCmd.AddCommand(&cobra.Command{
		Use:   "set <key> <value>",
		Short: "Write a config value",
		Args:  exactArgs(2),
		RunE:  runConfigSet,
	})
	configCmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "Show all config (secrets redacted)",
		RunE:  runConfigList,
	})
	rootCmd.AddCommand(configCmd)

	// jib backup-dest (hidden alias for backward compat — use "jib backup dest" instead)
	backupDestCmd := &cobra.Command{
		Use:    "backup-dest",
		Short:  "Manage backup destinations",
		Hidden: true,
	}
	populateBackupDestSubcommands(backupDestCmd)
	rootCmd.AddCommand(backupDestCmd)
}

// newBackupDestCmd creates the "dest" subcommand for the backup command.
func newBackupDestCmd() *cobra.Command {
	destCmd := &cobra.Command{
		Use:   "dest",
		Short: "Manage backup destinations",
	}
	populateBackupDestSubcommands(destCmd)
	return destCmd
}

// populateBackupDestSubcommands adds add/remove/list/test subcommands to the given parent.
func populateBackupDestSubcommands(parent *cobra.Command) {
	addDestCmd := &cobra.Command{
		Use:   "add <name>",
		Short: "Add a backup destination",
		Args:  exactArgs(1),
		RunE:  runBackupDestAdd,
	}
	addDestCmd.Flags().String("driver", "", "Driver: r2, s3, ssh, or local")
	addDestCmd.Flags().String("bucket", "", "Bucket name (for r2/s3)")
	addDestCmd.Flags().String("host", "", "SSH host (for ssh)")
	addDestCmd.Flags().String("path", "", "Path (for ssh/local)")
	addDestCmd.Flags().Int("retain", 7, "Number of backups to retain")
	parent.AddCommand(addDestCmd)

	parent.AddCommand(&cobra.Command{
		Use:   "remove <name>",
		Short: "Remove a backup destination",
		Args:  exactArgs(1),
		RunE:  runBackupDestRemove,
	})
	parent.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "Show configured backup destinations",
		RunE:  runBackupDestList,
	})
	parent.AddCommand(&cobra.Command{
		Use:   "test <name>",
		Short: "Test a backup destination (write/read/delete)",
		Args:  exactArgs(1),
		RunE:  runBackupDestTest,
	})
}

func runConfigGet(cmd *cobra.Command, args []string) error {
	key := args[0]

	data, err := os.ReadFile(configPath())
	if err != nil {
		return fmt.Errorf("reading config: %w", err)
	}

	var raw map[string]interface{}
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("parsing config: %w", err)
	}

	val, err := getNestedValue(raw, key)
	if err != nil {
		return err
	}

	// If the value is a map or slice, print as YAML
	switch v := val.(type) {
	case map[string]interface{}, []interface{}:
		out, err := yaml.Marshal(v)
		if err != nil {
			return fmt.Errorf("marshaling value: %w", err)
		}
		fmt.Print(string(out))
	default:
		fmt.Println(val)
	}
	return nil
}

func runConfigSet(cmd *cobra.Command, args []string) error {
	key := args[0]
	value := args[1]

	// Parse value as YAML to preserve correct types (bool, int, etc.)
	var parsed interface{}
	if err := yaml.Unmarshal([]byte(value), &parsed); err != nil {
		return fmt.Errorf("parsing value %q: %w", value, err)
	}

	// YAML unmarshals "" and "null" to nil; treat empty input as empty string,
	// and reject explicit null since unsetting keys should use 'jib edit'.
	if parsed == nil {
		if value == "" {
			parsed = ""
		} else {
			return fmt.Errorf("null values cannot be set via 'config set'; use 'jib edit' to remove a key")
		}
	}

	// Reject complex types — user should use `jib edit` for maps/lists
	switch parsed.(type) {
	case map[string]interface{}, []interface{}:
		return fmt.Errorf("complex values (maps/lists) cannot be set via 'config set'; use 'jib edit' instead")
	}

	path := configPath()

	if err := config.ModifyRawConfig(path, func(raw map[string]interface{}) error {
		return setNestedValue(raw, key, parsed)
	}); err != nil {
		return err
	}

	// Validate the newly written config
	if _, err := config.LoadConfig(path); err != nil {
		fmt.Fprintf(os.Stderr, "warning: config validation failed after set: %v\n", err)
	}

	fmt.Printf("Set %s = %v\n", key, parsed)
	return nil
}

func runConfigList(cmd *cobra.Command, args []string) error {
	data, err := os.ReadFile(configPath())
	if err != nil {
		return fmt.Errorf("reading config: %w", err)
	}

	fmt.Print(string(data))
	return nil
}

// getNestedValue looks up a dotted key path (e.g. "apps.myapp.repo") in a map.
func getNestedValue(m map[string]interface{}, key string) (interface{}, error) {
	parts := strings.Split(key, ".")
	var current interface{} = m

	for _, part := range parts {
		switch v := current.(type) {
		case map[string]interface{}:
			val, ok := v[part]
			if !ok {
				return nil, fmt.Errorf("key %q not found", key)
			}
			current = val
		default:
			return nil, fmt.Errorf("key %q not found (intermediate value is not a map)", key)
		}
	}
	return current, nil
}

// setNestedValue sets a dotted key path in a map, creating intermediate maps as needed.
func setNestedValue(m map[string]interface{}, key string, value interface{}) error {
	parts := strings.Split(key, ".")
	current := m

	for i, part := range parts {
		if i == len(parts)-1 {
			// Last part: set the value
			current[part] = value
			return nil
		}
		// Intermediate part: navigate or create
		next, ok := current[part]
		if !ok {
			newMap := make(map[string]interface{})
			current[part] = newMap
			current = newMap
			continue
		}
		nextMap, ok := next.(map[string]interface{})
		if !ok {
			return fmt.Errorf("key %q: intermediate value %q is not a map", key, part)
		}
		current = nextMap
	}
	return nil
}

func runBackupDestAdd(cmd *cobra.Command, args []string) error {
	name := args[0]
	driver, _ := cmd.Flags().GetString("driver")
	bucket, _ := cmd.Flags().GetString("bucket")
	host, _ := cmd.Flags().GetString("host")
	path, _ := cmd.Flags().GetString("path")
	retain, _ := cmd.Flags().GetInt("retain")

	if driver == "" {
		return fmt.Errorf("--driver is required (r2, s3, ssh, or local)")
	}

	validDrivers := map[string]bool{"r2": true, "s3": true, "ssh": true, "local": true}
	if !validDrivers[driver] {
		return fmt.Errorf("invalid driver %q: must be r2, s3, ssh, or local", driver)
	}

	switch driver {
	case "r2", "s3":
		if bucket == "" {
			return fmt.Errorf("--bucket is required for %s driver", driver)
		}
	case "ssh":
		if host == "" {
			return fmt.Errorf("--host is required for ssh driver")
		}
		if path == "" {
			path = "/backups"
		}
	case "local":
		if path == "" {
			path = "/opt/jib/backups"
		}
	}

	cfgPath := configPath()
	if err := config.ModifyRawConfig(cfgPath, func(raw map[string]interface{}) error {
		// Get or create backup_destinations section
		destsRaw, ok := raw["backup_destinations"]
		if !ok {
			destsRaw = make(map[string]interface{})
			raw["backup_destinations"] = destsRaw
		}
		destsMap, ok := destsRaw.(map[string]interface{})
		if !ok {
			return fmt.Errorf("backup_destinations section in config is not a map")
		}

		if _, exists := destsMap[name]; exists {
			return fmt.Errorf("backup destination %q already exists", name)
		}

		// Build the destination entry
		dest := map[string]interface{}{
			"driver": driver,
		}
		if bucket != "" {
			dest["bucket"] = bucket
		}
		if host != "" {
			dest["host"] = host
		}
		if path != "" {
			dest["path"] = path
		}
		if retain > 0 {
			dest["retain"] = retain
		}

		destsMap[name] = dest
		return nil
	}); err != nil {
		return err
	}

	// Validate
	if _, err := config.LoadConfig(cfgPath); err != nil {
		fmt.Fprintf(os.Stderr, "warning: config validation failed: %v\n", err)
	}

	fmt.Printf("Added backup destination %q (driver: %s).\n", name, driver)
	return nil
}

func runBackupDestRemove(cmd *cobra.Command, args []string) error {
	name := args[0]

	cfgPath := configPath()
	if err := config.ModifyRawConfig(cfgPath, func(raw map[string]interface{}) error {
		destsRaw, ok := raw["backup_destinations"]
		if !ok {
			return fmt.Errorf("no backup destinations configured")
		}
		destsMap, ok := destsRaw.(map[string]interface{})
		if !ok {
			return fmt.Errorf("backup_destinations is not a map")
		}

		if _, exists := destsMap[name]; !exists {
			return fmt.Errorf("backup destination %q not found", name)
		}

		delete(destsMap, name)

		// Remove the section entirely if empty
		if len(destsMap) == 0 {
			delete(raw, "backup_destinations")
		}
		return nil
	}); err != nil {
		return err
	}

	fmt.Printf("Removed backup destination %q.\n", name)
	return nil
}

func runBackupDestList(cmd *cobra.Command, args []string) error {
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	if len(cfg.BackupDests) == 0 {
		fmt.Println("No backup destinations configured.")
		fmt.Println("Add one with: jib backup dest add <name> --driver <r2|s3|ssh|local>")
		return nil
	}

	fmt.Printf("%-15s  %-8s  %-30s  %s\n", "NAME", "DRIVER", "TARGET", "RETAIN")
	fmt.Printf("%-15s  %-8s  %-30s  %s\n", "----", "------", "------", "------")
	for name, dest := range cfg.BackupDests {
		target := ""
		switch dest.Driver {
		case "r2", "s3":
			target = dest.Bucket
		case "ssh":
			target = dest.Host + ":" + dest.Path
		case "local":
			target = dest.Path
		}
		retain := "unlimited"
		if dest.Retain > 0 {
			retain = fmt.Sprintf("%d", dest.Retain)
		}
		fmt.Printf("%-15s  %-8s  %-30s  %s\n", name, dest.Driver, target, retain)
	}
	return nil
}

func runBackupDestTest(cmd *cobra.Command, args []string) error {
	name := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	destCfg, ok := cfg.BackupDests[name]
	if !ok {
		return fmt.Errorf("backup destination %q not found in config", name)
	}

	dest, err := backup.NewDestination(name, destCfg)
	if err != nil {
		return fmt.Errorf("creating destination: %w", err)
	}

	fmt.Printf("Testing backup destination %q (%s)...\n", name, dest.Driver())

	// Create a test file
	tmpFile, err := os.CreateTemp("", "jib-dest-test-*")
	if err != nil {
		return fmt.Errorf("creating test file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer func() { _ = os.Remove(tmpPath) }()

	testContent := "jib backup destination test"
	if _, err := tmpFile.WriteString(testContent); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("writing test file: %w", err)
	}
	_ = tmpFile.Close()

	testRemotePath := path.Join("_jib-test", "test-file.txt")

	// Upload
	fmt.Print("  Upload... ")
	if err := dest.Upload(tmpPath, testRemotePath); err != nil {
		fmt.Println("FAIL")
		return fmt.Errorf("upload failed: %w", err)
	}
	fmt.Println("OK")

	// List
	fmt.Print("  List... ")
	files, err := dest.List("_jib-test")
	if err != nil {
		fmt.Println("FAIL")
		return fmt.Errorf("list failed: %w", err)
	}
	found := false
	for _, f := range files {
		if f == "test-file.txt" {
			found = true
			break
		}
	}
	if !found {
		fmt.Println("FAIL (file not found in listing)")
		// Still try to clean up
		_ = dest.Delete(testRemotePath)
		return fmt.Errorf("uploaded file not found in listing")
	}
	fmt.Println("OK")

	// Download
	fmt.Print("  Download... ")
	dlPath := tmpPath + ".dl"
	defer func() { _ = os.Remove(dlPath) }()
	if err := dest.Download(testRemotePath, dlPath); err != nil {
		fmt.Println("FAIL")
		_ = dest.Delete(testRemotePath)
		return fmt.Errorf("download failed: %w", err)
	}
	dlContent, err := os.ReadFile(dlPath) //nolint:gosec // trusted temp file
	if err != nil || string(dlContent) != testContent {
		fmt.Println("FAIL (content mismatch)")
		_ = dest.Delete(testRemotePath)
		return fmt.Errorf("downloaded content does not match")
	}
	fmt.Println("OK")

	// Delete
	fmt.Print("  Delete... ")
	if err := dest.Delete(testRemotePath); err != nil {
		fmt.Println("FAIL")
		return fmt.Errorf("delete failed: %w", err)
	}
	fmt.Println("OK")

	fmt.Printf("\nAll tests passed for %q.\n", name)
	return nil
}
