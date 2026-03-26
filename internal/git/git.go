// Package git provides helper functions for common git operations.
package git

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// Clone runs git clone <url> <dir>. If sshKeyPath is non-empty, it's used
// as the identity file for SSH authentication.
func Clone(ctx context.Context, url, dir, branch, sshKeyPath string) error {
	args := []string{"clone", "--branch", branch, "--single-branch", url, dir}
	cmd := exec.CommandContext(ctx, "git", args...)
	if sshKeyPath != "" {
		cmd.Env = append(os.Environ(),
			fmt.Sprintf("GIT_SSH_COMMAND=ssh -i %s -o StrictHostKeyChecking=accept-new", sshKeyPath))
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git clone: %w: %s", err, string(out))
	}
	return nil
}

// IsRepo checks if the directory is a git repository.
func IsRepo(dir string) bool {
	cmd := exec.Command("git", "-C", dir, "rev-parse", "--git-dir")
	return cmd.Run() == nil
}

// ConfigureSSHKey sets the core.sshCommand in the repo's local git config
// so all git operations use the specified SSH key.
func ConfigureSSHKey(repoDir, sshKeyPath string) error {
	cmd := exec.Command("git", "config", "core.sshCommand",
		fmt.Sprintf("ssh -i %s -o StrictHostKeyChecking=accept-new", sshKeyPath))
	cmd.Dir = repoDir
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git config core.sshCommand: %w: %s", err, string(out))
	}
	return nil
}

// HasRemote checks if the repo has an "origin" remote configured.
func HasRemote(ctx context.Context, repoDir string) bool {
	cmd := exec.CommandContext(ctx, "git", "remote", "get-url", "origin")
	cmd.Dir = repoDir
	return cmd.Run() == nil
}

// Fetch runs git fetch origin <branch> in the given directory.
func Fetch(ctx context.Context, repoDir, branch string) error {
	cmd := exec.CommandContext(ctx, "git", "fetch", "origin", branch)
	cmd.Dir = repoDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git fetch origin %s: %w: %s", branch, err, string(out))
	}
	return nil
}

// Checkout runs git checkout <ref> in the given directory.
func Checkout(ctx context.Context, repoDir, ref string) error {
	cmd := exec.CommandContext(ctx, "git", "checkout", ref)
	cmd.Dir = repoDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git checkout %s: %w: %s", ref, err, string(out))
	}
	return nil
}

// CurrentSHA runs git rev-parse HEAD and returns the current SHA.
func CurrentSHA(ctx context.Context, repoDir string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "rev-parse", "HEAD")
	cmd.Dir = repoDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git rev-parse HEAD: %w: %s", err, string(out))
	}
	return strings.TrimSpace(string(out)), nil
}

// LsRemote runs git ls-remote to verify access to a repository.
func LsRemote(ctx context.Context, url, sshKeyPath string) error {
	cmd := exec.CommandContext(ctx, "git", "ls-remote", "--heads", url)
	if sshKeyPath != "" {
		cmd.Env = append(os.Environ(),
			fmt.Sprintf("GIT_SSH_COMMAND=ssh -i %s -o StrictHostKeyChecking=accept-new", sshKeyPath))
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git ls-remote: %w: %s", err, string(out))
	}
	return nil
}

// SetRemoteURL updates the origin remote URL.
func SetRemoteURL(ctx context.Context, repoDir, url string) error {
	cmd := exec.CommandContext(ctx, "git", "remote", "set-url", "origin", url)
	cmd.Dir = repoDir
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git remote set-url: %w: %s", err, string(out))
	}
	return nil
}

// RemoteSHA runs git rev-parse origin/<branch> and returns the remote branch SHA.
func RemoteSHA(ctx context.Context, repoDir, branch string) (string, error) {
	ref := "origin/" + branch
	cmd := exec.CommandContext(ctx, "git", "rev-parse", ref)
	cmd.Dir = repoDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git rev-parse %s: %w: %s", ref, err, string(out))
	}
	return strings.TrimSpace(string(out)), nil
}
