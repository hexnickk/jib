// Package git provides helper functions for common git operations.
package git

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

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
