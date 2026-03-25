package daemon

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/hexnickk/jib/internal/deploy"
	"github.com/hexnickk/jib/internal/state"
)

// runPoller polls git remotes for new commits and triggers deploys.
func (d *Daemon) runPoller(ctx context.Context) {
	// Wait a short time before the first poll to let things settle.
	select {
	case <-time.After(10 * time.Second):
	case <-ctx.Done():
		return
	}

	d.logger.Println("poller: started")

	for {
		interval := d.parsePollInterval()
		d.pollOnce(ctx)

		select {
		case <-time.After(interval):
		case <-ctx.Done():
			d.logger.Println("poller: stopped")
			return
		}
	}
}

// pollOnce checks each app for new remote commits and triggers deploys.
func (d *Daemon) pollOnce(ctx context.Context) {
	cfg := d.getConfig()

	for appName, appCfg := range cfg.Apps {
		if ctx.Err() != nil {
			return
		}

		// Skip apps with no remote (local repos).
		if appCfg.Repo == "local" || appCfg.Repo == "" {
			continue
		}

		// Load state to check if pinned or too many failures.
		appState, err := d.stateStore.Load(appName)
		if err != nil {
			d.logger.Printf("poller: %s: error loading state: %v", appName, err)
			continue
		}

		if appState.Pinned {
			continue
		}

		if appState.ConsecutiveFailures >= 3 {
			d.logger.Printf("poller: %s: skipping (consecutive failures: %d)", appName, appState.ConsecutiveFailures)
			continue
		}

		branch := appCfg.Branch
		if branch == "" {
			branch = "main"
		}

		repoDir := filepath.Join(d.Root, "repos", appName)

		// Check repo directory exists.
		if _, err := os.Stat(repoDir); os.IsNotExist(err) {
			continue
		}

		// Check if repo has a remote.
		if !gitHasRemote(ctx, repoDir) {
			continue
		}

		// Fetch from origin.
		if err := gitFetch(ctx, repoDir, branch); err != nil {
			d.logger.Printf("poller: %s: fetch error: %v", appName, err)
			continue
		}

		// Compare remote HEAD with deployed SHA.
		remoteSHA, err := gitRemoteSHA(ctx, repoDir, branch)
		if err != nil {
			d.logger.Printf("poller: %s: error getting remote SHA: %v", appName, err)
			continue
		}

		if remoteSHA == appState.DeployedSHA {
			continue
		}

		d.logger.Printf("poller: %s: new commit detected %s (was %s)", appName, short(remoteSHA), short(appState.DeployedSHA))

		// Try non-blocking lock — if deploy is already in progress, skip.
		lock, err := state.Acquire(appName, filepath.Join(d.Root, "locks"), false, 0)
		if err != nil {
			if errors.Is(err, state.ErrLockBusy) {
				d.logger.Printf("poller: %s: deploy already in progress, skipping", appName)
			} else {
				d.logger.Printf("poller: %s: lock error: %v", appName, err)
			}
			continue
		}
		// Release the probe lock — Deploy() will acquire its own lock.
		_ = lock.Release()

		// Trigger deploy.
		engine := d.newEngine()
		result, err := engine.Deploy(ctx, deploy.DeployOptions{
			App:     appName,
			Trigger: "autodeploy",
			User:    "autodeploy",
		})
		if err != nil {
			d.logger.Printf("poller: %s: deploy error: %v", appName, err)
			continue
		}

		if result.Success {
			d.logger.Printf("poller: %s: deployed %s", appName, short(result.DeployedSHA))
		} else {
			d.logger.Printf("poller: %s: deploy failed: %s", appName, result.Error)
		}
	}
}

// gitHasRemote checks if the repo has an "origin" remote configured.
func gitHasRemote(ctx context.Context, repoDir string) bool {
	cmd := exec.CommandContext(ctx, "git", "remote", "get-url", "origin")
	cmd.Dir = repoDir
	return cmd.Run() == nil
}

// gitFetch runs git fetch origin <branch> in the given directory.
func gitFetch(ctx context.Context, repoDir, branch string) error {
	cmd := exec.CommandContext(ctx, "git", "fetch", "origin", branch)
	cmd.Dir = repoDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git fetch origin %s: %w: %s", branch, err, string(out))
	}
	return nil
}

// gitRemoteSHA runs git rev-parse origin/<branch> and returns the remote branch SHA.
func gitRemoteSHA(ctx context.Context, repoDir, branch string) (string, error) {
	ref := "origin/" + branch
	cmd := exec.CommandContext(ctx, "git", "rev-parse", ref)
	cmd.Dir = repoDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git rev-parse %s: %w: %s", ref, err, string(out))
	}
	return strings.TrimSpace(string(out)), nil
}

// short returns the first 7 characters of a SHA, or the whole string if shorter.
func short(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}
