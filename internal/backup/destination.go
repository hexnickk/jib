package backup

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/util"
)

// Destination is the interface for backup storage backends.
type Destination interface {
	// Upload copies a local file to the remote path.
	Upload(src, remotePath string) error
	// Download copies a remote file to a local path.
	Download(remotePath, dst string) error
	// List returns remote paths matching a prefix.
	List(prefix string) ([]string, error)
	// Delete removes a remote file.
	Delete(remotePath string) error
	// Driver returns the driver name.
	Driver() string
}

// NewDestination creates a Destination from a config entry.
func NewDestination(name string, cfg config.BackupDestination) (Destination, error) {
	switch cfg.Driver {
	case "r2", "s3":
		if cfg.Bucket == "" {
			return nil, fmt.Errorf("destination %q: bucket is required for %s driver", name, cfg.Driver)
		}
		return &RcloneDest{
			Name:       name,
			DriverName: cfg.Driver,
			Bucket:     cfg.Bucket,
		}, nil
	case "ssh":
		if cfg.Host == "" {
			return nil, fmt.Errorf("destination %q: host is required for ssh driver", name)
		}
		path := cfg.Path
		if path == "" {
			path = "/backups"
		}
		return &SSHDest{
			Name:       name,
			Host:       cfg.Host,
			RemotePath: path,
		}, nil
	case "local":
		path := cfg.Path
		if path == "" {
			path = "/opt/jib/backups"
		}
		return &LocalDest{
			Name:    name,
			BaseDir: path,
		}, nil
	default:
		return nil, fmt.Errorf("destination %q: unsupported driver %q", name, cfg.Driver)
	}
}

// --- RcloneDest (R2 / S3) ---

// RcloneDest uses rclone for R2 and S3 storage.
type RcloneDest struct {
	Name       string
	DriverName string
	Bucket     string
}

func (d *RcloneDest) Driver() string { return d.DriverName }

func (d *RcloneDest) remote(path string) string {
	return fmt.Sprintf("%s:%s/%s", d.Name, d.Bucket, path)
}

func (d *RcloneDest) Upload(src, remotePath string) error {
	remote := d.remote(remotePath)
	// rclone copyto copies a single file to a destination path
	cmd := exec.Command("rclone", "copyto", src, remote) //nolint:gosec // args from trusted config
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("rclone upload to %s: %w", remote, err)
	}
	return nil
}

func (d *RcloneDest) Download(remotePath, dst string) error {
	remote := d.remote(remotePath)
	cmd := exec.Command("rclone", "copyto", remote, dst) //nolint:gosec // args from trusted config
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("rclone download from %s: %w", remote, err)
	}
	return nil
}

func (d *RcloneDest) List(prefix string) ([]string, error) {
	remote := d.remote(prefix)
	cmd := exec.Command("rclone", "ls", remote) //nolint:gosec // args from trusted config
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("rclone list %s: %w", remote, err)
	}
	var files []string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// rclone ls output: "  size filename"
		parts := strings.Fields(line)
		if len(parts) >= 2 {
			files = append(files, parts[len(parts)-1])
		}
	}
	return files, nil
}

func (d *RcloneDest) Delete(remotePath string) error {
	remote := d.remote(remotePath)
	cmd := exec.Command("rclone", "deletefile", remote) //nolint:gosec // args from trusted config
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("rclone delete %s: %w", remote, err)
	}
	return nil
}

// --- SSHDest ---

// SSHDest uses rsync/ssh for backup storage.
type SSHDest struct {
	Name       string
	Host       string
	RemotePath string
}

func (d *SSHDest) Driver() string { return "ssh" }

func (d *SSHDest) remoteFull(path string) string {
	return fmt.Sprintf("%s:%s/%s", d.Host, d.RemotePath, path)
}

func (d *SSHDest) Upload(src, remotePath string) error {
	// Ensure the remote directory exists
	dir := filepath.Dir(remotePath)
	mkdirCmd := exec.Command("ssh", d.Host, "mkdir", "-p", filepath.Join(d.RemotePath, dir)) //nolint:gosec // args from trusted config
	if out, err := mkdirCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ssh mkdir on %s: %w: %s", d.Host, err, string(out))
	}

	remote := d.remoteFull(remotePath)
	cmd := exec.Command("rsync", "-avz", src, remote) //nolint:gosec // trusted CLI subprocess
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("rsync upload to %s: %w", remote, err)
	}
	return nil
}

func (d *SSHDest) Download(remotePath, dst string) error {
	remote := d.remoteFull(remotePath)
	cmd := exec.Command("rsync", "-avz", remote, dst) //nolint:gosec // trusted CLI subprocess
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("rsync download from %s: %w", remote, err)
	}
	return nil
}

func (d *SSHDest) List(prefix string) ([]string, error) {
	dir := filepath.Join(d.RemotePath, prefix)
	cmd := exec.Command("ssh", d.Host, "ls", "-1", dir) //nolint:gosec // args from trusted config
	out, err := cmd.Output()
	if err != nil {
		// Empty directory or not found — return empty
		return nil, nil
	}
	var files []string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			files = append(files, line)
		}
	}
	return files, nil
}

func (d *SSHDest) Delete(remotePath string) error {
	remote := filepath.Join(d.RemotePath, remotePath)
	cmd := exec.Command("ssh", d.Host, "rm", "-f", remote) //nolint:gosec // args from trusted config
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ssh delete %s: %w: %s", remote, err, string(out))
	}
	return nil
}

// --- LocalDest ---

// LocalDest stores backups on the local filesystem.
type LocalDest struct {
	Name    string
	BaseDir string
}

func (d *LocalDest) Driver() string { return "local" }

func (d *LocalDest) fullPath(remotePath string) string {
	return filepath.Join(d.BaseDir, remotePath)
}

func (d *LocalDest) Upload(src, remotePath string) error {
	dst := d.fullPath(remotePath)
	if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
		return fmt.Errorf("creating directory for %s: %w", dst, err)
	}
	return util.CopyFile(src, dst)
}

func (d *LocalDest) Download(remotePath, dst string) error {
	src := d.fullPath(remotePath)
	if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
		return fmt.Errorf("creating directory for %s: %w", dst, err)
	}
	return util.CopyFile(src, dst)
}

func (d *LocalDest) List(prefix string) ([]string, error) {
	dir := d.fullPath(prefix)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("listing %s: %w", dir, err)
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() {
			files = append(files, e.Name())
		}
	}
	return files, nil
}

func (d *LocalDest) Delete(remotePath string) error {
	path := d.fullPath(remotePath)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("deleting %s: %w", path, err)
	}
	return nil
}
