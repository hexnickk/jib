package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// DefaultConfigPath returns the standard location for the Jib config file.
func DefaultConfigPath() string {
	return "/opt/jib/config.yml"
}

// LoadConfig reads a YAML config file, applies defaults, and validates it.
func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path) //nolint:gosec // CLI tool reads user-specified config
	if err != nil {
		return nil, fmt.Errorf("reading config: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}

	// Default config_version to 1 if missing.
	if cfg.ConfigVersion == 0 {
		cfg.ConfigVersion = 1
	}

	// Refuse to load configs from a newer version of jib.
	if cfg.ConfigVersion > LatestConfigVersion {
		return nil, fmt.Errorf("config version %d is newer than this jib binary supports (v%d). Run 'jib upgrade' first", cfg.ConfigVersion, LatestConfigVersion)
	}

	// Migrate v1 → v2: move app-level ingress to per-domain.
	if cfg.ConfigVersion < 2 {
		for name, app := range cfg.Apps {
			if app.Ingress != "" && app.Ingress != "direct" {
				for i := range app.Domains {
					if app.Domains[i].Ingress == "" {
						app.Domains[i].Ingress = app.Ingress
					}
				}
			}
			app.Ingress = ""
			cfg.Apps[name] = app
		}
		cfg.ConfigVersion = 2
	}

	applyDefaults(&cfg)

	if err := Validate(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// applyDefaults fills in zero-value fields with sensible defaults.
func applyDefaults(cfg *Config) {
	if cfg.PollInterval == "" {
		cfg.PollInterval = "5m"
	}

	if cfg.Webhook != nil && cfg.Webhook.Port == 0 {
		cfg.Webhook.Port = 9090
	}

	for name, app := range cfg.Apps {
		if app.Branch == "" {
			app.Branch = "main"
		}
		if app.Strategy == "" {
			app.Strategy = "restart"
		}
		if app.EnvFile == "" {
			app.EnvFile = ".env"
		}
		cfg.Apps[name] = app
	}
}
