// Package backup provides backup and restore functionality for app volumes.
package backup

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/util"
)

// validVolumeName matches safe Docker volume name components.
var validVolumeName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`)

// Manager coordinates backups and restores.
type Manager struct {
	Config  *config.Config
	BaseDir string // local staging area, default /opt/jib/backups
}

// NewManager creates a backup manager.
func NewManager(cfg *config.Config, baseDir string) *Manager {
	if baseDir == "" {
		baseDir = "/opt/jib/backups"
	}
	return &Manager{Config: cfg, BaseDir: baseDir}
}

// BackupResult holds the outcome of a backup operation.
type BackupResult struct {
	App         string    `json:"app"`
	Timestamp   string    `json:"timestamp"`
	ArchivePath string    `json:"archive_path"`
	ArchiveSize int64     `json:"archive_size"`
	SHA256      string    `json:"sha256"`
	Volumes     []string  `json:"volumes"`
	Uploaded    []string  `json:"uploaded_to"`
	CreatedAt   time.Time `json:"created_at"`
}

// Manifest describes the contents of a backup archive.
type Manifest struct {
	App       string    `json:"app"`
	Timestamp string    `json:"timestamp"`
	Volumes   []string  `json:"volumes"`
	SHA256    string    `json:"sha256"`
	CreatedAt time.Time `json:"created_at"`
}

// BackupInfo describes an available backup for listing.
type BackupInfo struct {
	App         string `json:"app"`
	Timestamp   string `json:"timestamp"`
	Filename    string `json:"filename"`
	Destination string `json:"destination"`
}

// Backup creates a backup of the specified app's volumes.
func (m *Manager) Backup(app string, appCfg config.App) (*BackupResult, error) {
	if appCfg.Backup == nil {
		return nil, fmt.Errorf("app %q has no backup configuration", app)
	}

	volumes := appCfg.Backup.Volumes
	if len(volumes) == 0 {
		return nil, fmt.Errorf("app %q has no volumes configured for backup", app)
	}

	destNames := appCfg.Backup.EffectiveDestinations()
	if len(destNames) == 0 {
		return nil, fmt.Errorf("app %q has no backup destinations configured", app)
	}

	// Resolve destinations
	dests, err := m.resolveDestinations(destNames)
	if err != nil {
		return nil, err
	}

	timestamp := time.Now().UTC().Format("20060102-150405")

	// Create temp dir for staging
	tmpDir, err := os.MkdirTemp("", "jib-backup-"+app+"-")
	if err != nil {
		return nil, fmt.Errorf("creating temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// Docker project name
	project := "jib-" + app

	// Backup each volume
	for _, vol := range volumes {
		volumeName := project + "_" + vol
		archiveName := vol + ".tar.gz"

		fmt.Printf("  Backing up volume %s...\n", volumeName)

		cmd := exec.Command("docker", "run", "--rm",
			"-v", volumeName+":/data:ro",
			"-v", tmpDir+":/backup",
			"alpine",
			"tar", "czf", "/backup/"+archiveName, "-C", "/data", ".",
		)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return nil, fmt.Errorf("backing up volume %s: %w", volumeName, err)
		}
	}

	// Create manifest
	manifest := Manifest{
		App:       app,
		Timestamp: timestamp,
		Volumes:   volumes,
		CreatedAt: time.Now().UTC(),
	}

	manifestData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshaling manifest: %w", err)
	}
	manifestPath := filepath.Join(tmpDir, "manifest.json")
	if err := os.WriteFile(manifestPath, manifestData, 0o644); err != nil {
		return nil, fmt.Errorf("writing manifest: %w", err)
	}

	// Bundle everything into a single tar.gz
	bundleName := fmt.Sprintf("%s-%s.tar.gz", app, timestamp)
	bundlePath := filepath.Join(m.BaseDir, bundleName)

	if err := os.MkdirAll(m.BaseDir, 0o700); err != nil {
		return nil, fmt.Errorf("creating backup dir: %w", err)
	}

	// Build tar arguments: tar czf <bundle> -C <tmpdir> manifest.json vol1.tar.gz vol2.tar.gz
	tarArgs := []string{"czf", bundlePath, "-C", tmpDir, "manifest.json"}
	for _, vol := range volumes {
		tarArgs = append(tarArgs, vol+".tar.gz")
	}
	tarCmd := exec.Command("tar", tarArgs...)
	tarCmd.Stdout = os.Stdout
	tarCmd.Stderr = os.Stderr
	if err := tarCmd.Run(); err != nil {
		return nil, fmt.Errorf("creating backup bundle: %w", err)
	}

	// Compute SHA256
	sha, err := fileSHA256(bundlePath)
	if err != nil {
		return nil, fmt.Errorf("computing SHA256: %w", err)
	}

	// Update manifest with SHA and rewrite
	manifest.SHA256 = sha

	// Get archive size
	info, err := os.Stat(bundlePath)
	if err != nil {
		return nil, fmt.Errorf("stat bundle: %w", err)
	}

	// Upload to each destination
	var uploaded []string
	for destName, dest := range dests {
		remotePath := path.Join(app, bundleName)
		fmt.Printf("  Uploading to %s (%s)...\n", destName, dest.Driver())
		if err := dest.Upload(bundlePath, remotePath); err != nil {
			fmt.Fprintf(os.Stderr, "  warning: upload to %s failed: %v\n", destName, err)
			continue
		}
		uploaded = append(uploaded, destName)

		// Apply retention
		destCfg := m.Config.BackupDests[destName]
		if destCfg.Retain > 0 {
			if err := m.applyRetention(dest, app, destCfg.Retain); err != nil {
				fmt.Fprintf(os.Stderr, "  warning: retention cleanup for %s failed: %v\n", destName, err)
			}
		}
	}

	result := &BackupResult{
		App:         app,
		Timestamp:   timestamp,
		ArchivePath: bundlePath,
		ArchiveSize: info.Size(),
		SHA256:      sha,
		Volumes:     volumes,
		Uploaded:    uploaded,
		CreatedAt:   time.Now().UTC(),
	}

	return result, nil
}

// Restore restores an app from a backup.
func (m *Manager) Restore(app string, timestamp string, dryRun bool) error {
	appCfg, ok := m.Config.Apps[app]
	if !ok {
		return fmt.Errorf("app %q not found in config", app)
	}
	if appCfg.Backup == nil {
		return fmt.Errorf("app %q has no backup configuration", app)
	}

	destNames := appCfg.Backup.EffectiveDestinations()
	if len(destNames) == 0 {
		return fmt.Errorf("app %q has no backup destinations", app)
	}

	bundleName := fmt.Sprintf("%s-%s.tar.gz", app, timestamp)
	remotePath := path.Join(app, bundleName)

	// Try to download from the first available destination
	tmpDir, err := os.MkdirTemp("", "jib-restore-"+app+"-")
	if err != nil {
		return fmt.Errorf("creating temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	localBundle := filepath.Join(tmpDir, bundleName)

	// First check if it exists locally in baseDir
	localPath := filepath.Join(m.BaseDir, bundleName)
	if _, err := os.Stat(localPath); err == nil {
		fmt.Printf("Using local backup: %s\n", localPath)
		if err := util.CopyFile(localPath, localBundle); err != nil {
			return fmt.Errorf("copying local backup: %w", err)
		}
	} else {
		// Download from destinations
		downloaded := false
		for _, destName := range destNames {
			destCfg, ok := m.Config.BackupDests[destName]
			if !ok {
				continue
			}
			dest, err := NewDestination(destName, destCfg)
			if err != nil {
				fmt.Fprintf(os.Stderr, "  warning: skipping destination %s: %v\n", destName, err)
				continue
			}
			fmt.Printf("Downloading backup from %s...\n", destName)
			if err := dest.Download(remotePath, localBundle); err != nil {
				fmt.Fprintf(os.Stderr, "  warning: download from %s failed: %v\n", destName, err)
				continue
			}
			downloaded = true
			break
		}
		if !downloaded {
			return fmt.Errorf("could not download backup %s from any destination", bundleName)
		}
	}

	// Extract the bundle
	extractDir := filepath.Join(tmpDir, "extracted")
	if err := os.MkdirAll(extractDir, 0o755); err != nil {
		return fmt.Errorf("creating extract dir: %w", err)
	}

	extractCmd := exec.Command("tar", "--no-same-owner", "-xzf", localBundle, "-C", extractDir)
	extractCmd.Stdout = os.Stdout
	extractCmd.Stderr = os.Stderr
	if err := extractCmd.Run(); err != nil {
		return fmt.Errorf("extracting backup: %w", err)
	}

	// Read manifest
	manifestPath := filepath.Join(extractDir, "manifest.json")
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		return fmt.Errorf("reading manifest: %w", err)
	}

	var manifest Manifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return fmt.Errorf("parsing manifest: %w", err)
	}

	fmt.Printf("Backup: %s @ %s\n", manifest.App, manifest.Timestamp)
	fmt.Printf("Volumes: %s\n", strings.Join(manifest.Volumes, ", "))
	if manifest.SHA256 != "" {
		fmt.Printf("SHA256: %s\n", manifest.SHA256)
	}

	if dryRun {
		fmt.Println("\nDry-run mode: backup verified, no changes made.")
		// List archive contents
		for _, vol := range manifest.Volumes {
			volArchive := filepath.Join(extractDir, vol+".tar.gz")
			if info, err := os.Stat(volArchive); err == nil {
				fmt.Printf("  %s.tar.gz: %s\n", vol, HumanSize(info.Size()))
			}
		}
		return nil
	}

	project := "jib-" + app

	// Stop app containers
	fmt.Println("Stopping containers...")
	stopCmd := exec.Command("docker", "compose", "-p", project, "down")
	stopCmd.Stdout = os.Stdout
	stopCmd.Stderr = os.Stderr
	if err := stopCmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "warning: stopping containers: %v (continuing anyway)\n", err)
	}

	// Restore each volume
	for _, vol := range manifest.Volumes {
		// Validate volume name to prevent path traversal and shell injection.
		if !validVolumeName.MatchString(vol) {
			return fmt.Errorf("invalid volume name in manifest: %q", vol)
		}
		if strings.Contains(vol, "..") {
			return fmt.Errorf("invalid volume name in manifest (path traversal): %q", vol)
		}

		volumeName := project + "_" + vol
		volArchive := filepath.Join(extractDir, vol+".tar.gz")

		if _, err := os.Stat(volArchive); err != nil {
			return fmt.Errorf("volume archive %s not found in backup", vol+".tar.gz")
		}

		fmt.Printf("  Restoring volume %s...\n", volumeName)

		// Clear existing data and restore
		cmd := exec.Command("docker", "run", "--rm",
			"-v", volumeName+":/data",
			"-v", extractDir+":/backup:ro",
			"alpine",
			"sh", "-c", "rm -rf /data/* /data/..?* /data/.[!.]* 2>/dev/null; tar --no-same-owner -xzf /backup/"+vol+".tar.gz -C /data",
		)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("restoring volume %s: %w", volumeName, err)
		}
	}

	// Start app containers back up
	fmt.Println("Starting containers...")
	startCmd := exec.Command("docker", "compose", "-p", project, "up", "-d")
	startCmd.Stdout = os.Stdout
	startCmd.Stderr = os.Stderr
	if err := startCmd.Run(); err != nil {
		return fmt.Errorf("starting containers: %w", err)
	}

	fmt.Println("Restore complete.")
	return nil
}

// List returns available backups for an app across all destinations.
func (m *Manager) List(app string) ([]BackupInfo, error) {
	appCfg, ok := m.Config.Apps[app]
	if !ok {
		return nil, fmt.Errorf("app %q not found in config", app)
	}
	if appCfg.Backup == nil {
		return nil, fmt.Errorf("app %q has no backup configuration", app)
	}

	destNames := appCfg.Backup.EffectiveDestinations()
	var allBackups []BackupInfo

	// Also check local staging area
	localFiles, err := listLocalBackups(m.BaseDir, app)
	if err == nil {
		for _, f := range localFiles {
			allBackups = append(allBackups, BackupInfo{
				App:         app,
				Timestamp:   extractTimestamp(app, f),
				Filename:    f,
				Destination: "local-staging",
			})
		}
	}

	for _, destName := range destNames {
		destCfg, ok := m.Config.BackupDests[destName]
		if !ok {
			continue
		}
		dest, err := NewDestination(destName, destCfg)
		if err != nil {
			fmt.Fprintf(os.Stderr, "  warning: skipping destination %s: %v\n", destName, err)
			continue
		}

		files, err := dest.List(app)
		if err != nil {
			fmt.Fprintf(os.Stderr, "  warning: listing %s: %v\n", destName, err)
			continue
		}

		for _, f := range files {
			if !strings.HasSuffix(f, ".tar.gz") {
				continue
			}
			allBackups = append(allBackups, BackupInfo{
				App:         app,
				Timestamp:   extractTimestamp(app, f),
				Filename:    f,
				Destination: destName,
			})
		}
	}

	// Sort by timestamp (descending — newest first)
	sort.Slice(allBackups, func(i, j int) bool {
		return allBackups[i].Timestamp > allBackups[j].Timestamp
	})

	return allBackups, nil
}

// resolveDestinations resolves destination names to Destination implementations.
func (m *Manager) resolveDestinations(names []string) (map[string]Destination, error) {
	dests := make(map[string]Destination, len(names))
	for _, name := range names {
		cfg, ok := m.Config.BackupDests[name]
		if !ok {
			return nil, fmt.Errorf("backup destination %q not defined in config", name)
		}
		d, err := NewDestination(name, cfg)
		if err != nil {
			return nil, err
		}
		dests[name] = d
	}
	return dests, nil
}

// applyRetention deletes old backups beyond the retain count.
func (m *Manager) applyRetention(dest Destination, app string, retain int) error {
	files, err := dest.List(app)
	if err != nil {
		return err
	}

	// Filter to only backup archives for this app
	var archives []string
	prefix := app + "-"
	for _, f := range files {
		if strings.HasPrefix(f, prefix) && strings.HasSuffix(f, ".tar.gz") {
			archives = append(archives, f)
		}
	}

	// Sort ascending (oldest first)
	sort.Strings(archives)

	if len(archives) <= retain {
		return nil
	}

	// Delete oldest archives beyond retain count
	toDelete := archives[:len(archives)-retain]
	for _, f := range toDelete {
		remotePath := path.Join(app, f)
		fmt.Printf("  Retention: deleting %s\n", f)
		if err := dest.Delete(remotePath); err != nil {
			fmt.Fprintf(os.Stderr, "  warning: deleting %s: %v\n", f, err)
		}
	}

	return nil
}

// listLocalBackups lists backup files in the local staging area.
func listLocalBackups(baseDir, app string) ([]string, error) {
	entries, err := os.ReadDir(baseDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	prefix := app + "-"
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), prefix) && strings.HasSuffix(e.Name(), ".tar.gz") {
			files = append(files, e.Name())
		}
	}
	return files, nil
}

// extractTimestamp extracts the timestamp from a backup filename like "app-20060102-150405.tar.gz".
func extractTimestamp(app, filename string) string {
	prefix := app + "-"
	suffix := ".tar.gz"
	if strings.HasPrefix(filename, prefix) && strings.HasSuffix(filename, suffix) {
		ts := filename[len(prefix) : len(filename)-len(suffix)]
		return ts
	}
	return filename
}

// fileSHA256 computes the SHA256 hash of a file.
func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// HumanSize formats bytes in a human-readable format.
func HumanSize(bytes int64) string {
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
	)
	switch {
	case bytes >= GB:
		return fmt.Sprintf("%.1f GB", float64(bytes)/float64(GB))
	case bytes >= MB:
		return fmt.Sprintf("%.1f MB", float64(bytes)/float64(MB))
	case bytes >= KB:
		return fmt.Sprintf("%.1f KB", float64(bytes)/float64(KB))
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}
