package config

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// ModifyRawConfig reads the YAML config at cfgPath, unmarshals it into a
// map[string]interface{}, calls mutate to modify it, then atomically writes
// the result back (via temp file + rename).
func ModifyRawConfig(cfgPath string, mutate func(raw map[string]interface{}) error) error {
	data, err := os.ReadFile(cfgPath) //nolint:gosec // CLI tool reads its own config file
	if err != nil {
		return fmt.Errorf("reading config: %w", err)
	}

	var raw map[string]interface{}
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("parsing config: %w", err)
	}
	if raw == nil {
		raw = make(map[string]interface{})
	}

	if err := mutate(raw); err != nil {
		return err
	}

	out, err := yaml.Marshal(raw)
	if err != nil {
		return fmt.Errorf("marshaling config: %w", err)
	}

	// Write to a temp file in the same directory, then rename for atomicity.
	dir := filepath.Dir(cfgPath)
	tmp, err := os.CreateTemp(dir, ".jib-config-*.yml")
	if err != nil {
		return fmt.Errorf("creating temp file: %w", err)
	}
	tmpPath := tmp.Name()

	if _, err := tmp.Write(out); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("writing temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("closing temp file: %w", err)
	}

	// Preserve the permissions of the original config file.
	origInfo, err := os.Stat(cfgPath)
	if err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("stat config: %w", err)
	}
	if err := os.Chmod(tmpPath, origInfo.Mode().Perm()); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("setting permissions: %w", err)
	}

	if err := os.Rename(tmpPath, cfgPath); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("renaming temp file: %w", err)
	}

	return nil
}
