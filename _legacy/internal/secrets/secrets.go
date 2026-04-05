package secrets

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/hexnickk/jib/internal/config"
)

// Manager handles secrets file operations.
type Manager struct {
	Dir string // base secrets directory
}

// NewManager creates a new Manager with the given base directory.
func NewManager(dir string) *Manager {
	return &Manager{Dir: dir}
}

// AppSecretStatus reports whether a secrets file exists for an app.
type AppSecretStatus struct {
	App    string
	Exists bool
	Path   string
}

func envFile(name string) string {
	if name == "" {
		return ".env"
	}
	return name
}

// Set copies the file at srcPath to <dir>/<app>/<envFileName>.
// Creates the app directory if needed. Sets 0700 on the directory and 0600 on the file.
func (m *Manager) Set(app string, srcPath string, envFileName string) error {
	envFileName = envFile(envFileName)

	appDir := filepath.Join(m.Dir, app)
	if err := os.MkdirAll(appDir, 0700); err != nil {
		return fmt.Errorf("creating secrets directory: %w", err)
	}
	// Ensure directory permissions even if it already existed.
	if err := os.Chmod(appDir, 0700); err != nil { //nolint:gosec // G302: directory needs execute bit for traversal
		return fmt.Errorf("setting directory permissions: %w", err)
	}

	src, err := os.Open(srcPath) //nolint:gosec // CLI tool reads user-specified secrets file
	if err != nil {
		return fmt.Errorf("opening source file: %w", err)
	}
	defer func() { _ = src.Close() }()

	dstPath := filepath.Join(appDir, envFileName)
	dst, err := os.OpenFile(dstPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600) //nolint:gosec // path constructed from trusted config
	if err != nil {
		return fmt.Errorf("creating secrets file: %w", err)
	}

	if _, err := io.Copy(dst, src); err != nil {
		_ = dst.Close()
		return fmt.Errorf("copying secrets file: %w", err)
	}

	if err := dst.Sync(); err != nil {
		_ = dst.Close()
		return fmt.Errorf("syncing secrets file: %w", err)
	}

	if err := dst.Close(); err != nil {
		return fmt.Errorf("closing secrets file: %w", err)
	}

	if err := os.Chmod(dstPath, 0600); err != nil {
		return fmt.Errorf("setting file permissions: %w", err)
	}

	return nil
}

// Check reports whether the secrets file exists for the given app.
// Returns whether it exists and the path that was checked.
func (m *Manager) Check(app string, envFileName string) (exists bool, path string) {
	path = filepath.Join(m.Dir, app, envFile(envFileName))
	_, err := os.Stat(path)
	return err == nil, path
}

// CheckAll checks all apps for secrets files.
// Returns a status entry for each app, sorted by app name.
func (m *Manager) CheckAll(apps map[string]config.App) []AppSecretStatus {
	var results []AppSecretStatus
	for name, app := range apps {
		exists, path := m.Check(name, app.EnvFile)
		results = append(results, AppSecretStatus{
			App:    name,
			Exists: exists,
			Path:   path,
		})
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].App < results[j].App
	})
	return results
}

// SetVar updates or appends one or more KEY=VALUE pairs in the app's .env file.
// Creates the directory (0700) and file (0600) if they don't exist.
func (m *Manager) SetVar(app string, envFileName string, vars map[string]string) error {
	envFileName = envFile(envFileName)
	appDir := filepath.Join(m.Dir, app)

	if err := os.MkdirAll(appDir, 0700); err != nil {
		return fmt.Errorf("creating secrets directory: %w", err)
	}
	if err := os.Chmod(appDir, 0700); err != nil { //nolint:gosec // G302: directory needs execute bit for traversal
		return fmt.Errorf("setting directory permissions: %w", err)
	}

	path := filepath.Join(appDir, envFileName)
	lines, err := readLines(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("reading secrets file: %w", err)
	}

	// Track which vars have been updated (by key).
	updated := make(map[string]bool)

	// Update existing lines in place.
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		idx := strings.Index(line, "=")
		if idx < 0 {
			continue
		}
		key := line[:idx]
		if newVal, ok := vars[key]; ok {
			lines[i] = key + "=" + newVal
			updated[key] = true
		}
	}

	// Append any vars that weren't already present, in sorted order.
	var newKeys []string
	for key := range vars {
		if !updated[key] {
			newKeys = append(newKeys, key)
		}
	}
	sort.Strings(newKeys)
	for _, key := range newKeys {
		lines = append(lines, key+"="+vars[key])
	}

	return writeLines(path, lines)
}

// DelVar removes one or more keys from the app's .env file.
func (m *Manager) DelVar(app string, envFileName string, keys []string) error {
	envFileName = envFile(envFileName)
	path := filepath.Join(m.Dir, app, envFileName)

	lines, err := readLines(path)
	if err != nil {
		return fmt.Errorf("reading secrets file: %w", err)
	}

	keySet := make(map[string]bool, len(keys))
	for _, k := range keys {
		keySet[k] = true
	}

	var filtered []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			filtered = append(filtered, line)
			continue
		}
		idx := strings.Index(line, "=")
		if idx < 0 {
			filtered = append(filtered, line)
			continue
		}
		key := line[:idx]
		if keySet[key] {
			continue // skip this line
		}
		filtered = append(filtered, line)
	}

	return writeLines(path, filtered)
}

// readLines reads all lines from a file. Returns nil, nil if the file is empty.
func readLines(path string) ([]string, error) {
	f, err := os.Open(path) //nolint:gosec // path constructed from trusted config
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()

	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	return lines, scanner.Err()
}

// writeLines writes lines to a file with 0600 permissions.
func writeLines(path string, lines []string) error {
	content := strings.Join(lines, "\n")
	if len(lines) > 0 {
		content += "\n"
	}
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		return fmt.Errorf("writing secrets file: %w", err)
	}
	if err := os.Chmod(path, 0600); err != nil {
		return fmt.Errorf("setting file permissions: %w", err)
	}
	return nil
}

// Remove deletes the entire <dir>/<app>/ directory.
func (m *Manager) Remove(app string) error {
	return os.RemoveAll(filepath.Join(m.Dir, app))
}

// SymlinkPath returns the full path to the secrets file for the given app.
func (m *Manager) SymlinkPath(app string, envFileName string) string {
	return filepath.Join(m.Dir, app, envFile(envFileName))
}

// Symlink creates (or recreates) a symlink from <repoDir>/<envFileName> pointing
// to the secrets file. Any existing file or symlink at the target is removed first.
func (m *Manager) Symlink(app string, repoDir string, envFileName string) error {
	envFileName = envFile(envFileName)
	target := m.SymlinkPath(app, envFileName)
	link := filepath.Join(repoDir, envFileName)

	// Remove existing file or symlink.
	if err := os.Remove(link); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("removing existing file at %s: %w", link, err)
	}

	if err := os.Symlink(target, link); err != nil {
		return fmt.Errorf("creating symlink: %w", err)
	}

	return nil
}

// EnvRedacted reads the secrets file and returns lines with values redacted.
// For KEY=VALUE lines, values longer than 10 characters are shown as the first
// 10 characters followed by "***". Shorter non-empty values are replaced with "***".
// Empty values, comments, and blank lines are preserved.
func (m *Manager) EnvRedacted(app string, envFileName string) ([]string, error) {
	path := filepath.Join(m.Dir, app, envFile(envFileName))
	f, err := os.Open(path) //nolint:gosec // path constructed from trusted config
	if err != nil {
		return nil, fmt.Errorf("opening secrets file: %w", err)
	}
	defer func() { _ = f.Close() }()

	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		lines = append(lines, redactLine(scanner.Text()))
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading secrets file: %w", err)
	}

	return lines, nil
}

// redactLine redacts a single env file line.
func redactLine(line string) string {
	trimmed := strings.TrimSpace(line)

	// Preserve blank lines and comments.
	if trimmed == "" || strings.HasPrefix(trimmed, "#") {
		return line
	}

	idx := strings.Index(line, "=")
	if idx < 0 {
		return line
	}

	key := line[:idx]
	value := line[idx+1:]

	if value == "" {
		return line
	}

	if len(value) > 4 {
		return key + "=" + value[:4] + "***"
	}
	return key + "=***"
}
