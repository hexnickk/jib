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
