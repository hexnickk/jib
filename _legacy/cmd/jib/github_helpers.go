package main

import (
	"fmt"

	"github.com/hexnickk/jib/internal/config"
)

// providerNameAvailable checks that a provider name is not already taken.
// Lives in cmd/jib (not internal/github) because it's a CLI input-validation
// helper, not part of the GitHub library — it only exists to guard the two
// `jib github {app,key} setup` commands.
func providerNameAvailable(cfg *config.Config, name string) error {
	if _, ok := cfg.LookupProvider(name); ok {
		return fmt.Errorf("provider %q already exists", name)
	}
	return nil
}

// appsUsingProvider returns the names of apps referencing a given provider.
func appsUsingProvider(cfg *config.Config, providerName string) []string {
	var apps []string
	for name, app := range cfg.Apps {
		if app.Provider == providerName {
			apps = append(apps, name)
		}
	}
	return apps
}

// saveProvider adds a provider entry to the config YAML.
func saveProvider(name string, data map[string]interface{}) error {
	return config.ModifyRawConfig(config.ConfigFile(), func(raw map[string]interface{}) error {
		gh, ok := raw["github"].(map[string]interface{})
		if !ok {
			gh = make(map[string]interface{})
			raw["github"] = gh
		}
		providers, ok := gh["providers"].(map[string]interface{})
		if !ok {
			providers = make(map[string]interface{})
			gh["providers"] = providers
		}
		providers[name] = data
		return nil
	})
}

// removeProvider removes a provider entry from the config YAML.
func removeProvider(name string) error {
	return config.ModifyRawConfig(config.ConfigFile(), func(raw map[string]interface{}) error {
		gh, ok := raw["github"].(map[string]interface{})
		if !ok {
			return nil
		}
		providers, ok := gh["providers"].(map[string]interface{})
		if !ok {
			return nil
		}
		delete(providers, name)
		if len(providers) == 0 {
			delete(gh, "providers")
		}
		if len(gh) == 0 {
			delete(raw, "github")
		}
		return nil
	})
}
