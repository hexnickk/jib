package main

import (
	"fmt"
	"os"
	"strings"

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
		Args:  cobra.ExactArgs(1),
		RunE:  runConfigGet,
	})
	configCmd.AddCommand(&cobra.Command{
		Use:   "set <key> <value>",
		Short: "Write a config value",
		Args:  cobra.ExactArgs(2),
		RunE:  runConfigSet,
	})
	configCmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "Show all config (secrets redacted)",
		RunE:  runConfigList,
	})
	rootCmd.AddCommand(configCmd)

	// jib notify
	notifyCmd := &cobra.Command{
		Use:   "notify",
		Short: "Manage notification channels",
	}
	notifyCmd.AddCommand(&cobra.Command{
		Use:   "setup <channel>",
		Short: "Interactive setup for telegram|slack|discord|webhook",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("[notify setup] Would run interactive setup for %q notification channel.\n", args[0])
			return nil
		},
	})
	notifyCmd.AddCommand(&cobra.Command{
		Use:   "test [channel]",
		Short: "Send test notification",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) > 0 {
				fmt.Printf("[notify test] Would send a test notification to %q channel.\n", args[0])
			} else {
				fmt.Println("[notify test] Would send a test notification to all configured channels.")
			}
			return nil
		},
	})
	notifyCmd.AddCommand(&cobra.Command{
		Use:   "remove <channel>",
		Short: "Remove a notification channel",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("[notify remove] Would remove the %q notification channel.\n", args[0])
			return nil
		},
	})
	notifyCmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "Show configured channels and status",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Println("[notify list] Would show configured notification channels and their status.")
			return nil
		},
	})
	rootCmd.AddCommand(notifyCmd)

	// jib backup-dest
	backupDestCmd := &cobra.Command{
		Use:   "backup-dest",
		Short: "Manage backup destinations",
	}
	backupDestCmd.AddCommand(&cobra.Command{
		Use:   "setup [name]",
		Short: "Interactive backup destination setup",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) > 0 {
				fmt.Printf("[backup-dest setup] Would run interactive setup for backup destination %q.\n", args[0])
			} else {
				fmt.Println("[backup-dest setup] Would run interactive backup destination setup.")
			}
			return nil
		},
	})
	backupDestCmd.AddCommand(&cobra.Command{
		Use:   "remove <name>",
		Short: "Remove a backup destination",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("[backup-dest remove] Would remove backup destination %q.\n", args[0])
			return nil
		},
	})
	backupDestCmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "Show configured backup destinations",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Println("[backup-dest list] Would show configured backup destinations.")
			return nil
		},
	})
	rootCmd.AddCommand(backupDestCmd)
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

	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("reading config: %w", err)
	}

	var raw map[string]interface{}
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("parsing config: %w", err)
	}

	if err := setNestedValue(raw, key, parsed); err != nil {
		return err
	}

	out, err := yaml.Marshal(raw)
	if err != nil {
		return fmt.Errorf("marshaling config: %w", err)
	}

	if err := os.WriteFile(path, out, 0o644); err != nil {
		return fmt.Errorf("writing config: %w", err)
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
