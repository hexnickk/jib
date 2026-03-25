// Package deploy implements the core deploy and rollback orchestration for Jib.
package deploy

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/docker"
	"github.com/hexnickk/jib/internal/history"
	"github.com/hexnickk/jib/internal/notify"
	"github.com/hexnickk/jib/internal/platform"
	"github.com/hexnickk/jib/internal/proxy"
	"github.com/hexnickk/jib/internal/secrets"
	"github.com/hexnickk/jib/internal/ssl"
	"github.com/hexnickk/jib/internal/state"
)

// minDiskBytes is the minimum free disk space required to deploy (2 GB).
const minDiskBytes uint64 = 2 * 1024 * 1024 * 1024

// lockTimeout is the maximum time to wait for a deploy lock in blocking mode.
const lockTimeout = 5 * time.Minute

// Engine orchestrates deploys and rollbacks.
type Engine struct {
	Config      *config.Config
	StateStore  *state.Store
	Secrets     *secrets.Manager
	Notifier    *notify.Multi
	Proxy       proxy.Proxy
	SSL         *ssl.CertManager
	History     *history.Logger
	LockDir     string
	RepoBaseDir string // e.g. /opt/jib/repos
	OverrideDir string // e.g. /opt/jib/overrides
}

// DeployOptions configures a single deploy invocation.
type DeployOptions struct {
	App     string
	Ref     string // git ref to deploy (empty = origin/<branch> HEAD)
	DryRun  bool
	Force   bool
	Trigger string // "manual" or "autodeploy"
	User    string // $USER or "autodeploy"
}

// DeployResult reports the outcome of a deploy or rollback.
type DeployResult struct {
	App         string
	PreviousSHA string
	DeployedSHA string
	Strategy    string
	Success     bool
	Error       string
}

// Deploy implements the full restart strategy deploy flow (steps 1-17 from the plan).
func (e *Engine) Deploy(ctx context.Context, opts DeployOptions) (*DeployResult, error) {
	deployStart := time.Now()

	// 1. Validate app exists in config.
	appCfg, ok := e.Config.Apps[opts.App]
	if !ok {
		return nil, fmt.Errorf("app %q not found in config", opts.App)
	}

	strategy := appCfg.Strategy
	if strategy == "" {
		strategy = "restart"
	}

	repoDir := filepath.Join(e.RepoBaseDir, opts.App)
	branch := appCfg.Branch
	if branch == "" {
		branch = "main"
	}

	// 2. Acquire flock.
	blocking := opts.Trigger != "autodeploy"
	lock, err := state.Acquire(opts.App, e.LockDir, blocking, lockTimeout)
	if err != nil {
		return nil, fmt.Errorf("acquiring lock: %w", err)
	}
	defer func() { _ = lock.Release() }()

	// 3. Check disk space.
	if err := checkDiskSpace(repoDir, minDiskBytes); err != nil {
		return nil, fmt.Errorf("disk space check: %w", err)
	}

	// 4. Validate secrets if secrets_env is true.
	if appCfg.SecretsEnv {
		exists, secretPath := e.Secrets.Check(opts.App, appCfg.EnvFile)
		if !exists {
			return nil, fmt.Errorf("secrets file missing for app %q (expected at %s)", opts.App, secretPath)
		}
	}

	// Load current state for previous SHA tracking.
	appState, err := e.StateStore.Load(opts.App)
	if err != nil {
		return nil, fmt.Errorf("loading state: %w", err)
	}
	previousSHA := appState.DeployedSHA

	// 5. Git fetch and determine target ref.
	hasRemote := gitHasRemote(ctx, repoDir)
	if hasRemote {
		if err := gitFetch(ctx, repoDir, branch); err != nil {
			return nil, fmt.Errorf("git fetch: %w", err)
		}
	}

	targetRef := opts.Ref
	if targetRef == "" {
		if hasRemote {
			remoteSHA, err := gitRemoteSHA(ctx, repoDir, branch)
			if err != nil {
				return nil, fmt.Errorf("resolving remote HEAD: %w", err)
			}
			targetRef = remoteSHA
		} else {
			// Local-only repo: use current HEAD
			localSHA, err := gitCurrentSHA(ctx, repoDir)
			if err != nil {
				return nil, fmt.Errorf("resolving local HEAD: %w", err)
			}
			targetRef = localSHA
		}
	}

	// Check if already at target SHA (skip unless --force).
	currentSHA, _ := gitCurrentSHA(ctx, repoDir)
	if currentSHA == targetRef && previousSHA == targetRef && !opts.Force {
		return &DeployResult{
			App:         opts.App,
			PreviousSHA: previousSHA,
			DeployedSHA: targetRef,
			Strategy:    strategy,
			Success:     true,
		}, nil
	}

	// Dry-run: report what would happen and return.
	if opts.DryRun {
		fmt.Printf("DRY RUN — %s (%s strategy)\n", opts.App, strategy)
		fmt.Printf("  Current SHA: %s\n", currentSHA)
		fmt.Printf("  Target SHA:  %s\n", targetRef)
		if len(appCfg.PreDeploy) > 0 {
			fmt.Printf("  Pre-deploy hooks:\n")
			for _, h := range appCfg.PreDeploy {
				fmt.Printf("    - %s\n", h.Service)
			}
		}
		if len(appCfg.BuildArgs) > 0 {
			fmt.Printf("  Build args:\n")
			for k, v := range appCfg.BuildArgs {
				fmt.Printf("    %s=%s\n", k, v)
			}
		}
		if len(appCfg.Services) > 0 {
			fmt.Printf("  Services: %s\n", strings.Join(appCfg.Services, ", "))
		}
		return &DeployResult{
			App:         opts.App,
			PreviousSHA: previousSHA,
			DeployedSHA: targetRef,
			Strategy:    strategy,
			Success:     true,
		}, nil
	}

	// 5 (cont). Git checkout target ref.
	if err := gitCheckout(ctx, repoDir, targetRef); err != nil {
		return nil, fmt.Errorf("git checkout: %w", err)
	}

	// 6. Symlink secrets .env into repo.
	if appCfg.SecretsEnv {
		if err := e.Secrets.Symlink(opts.App, repoDir, appCfg.EnvFile); err != nil {
			return nil, fmt.Errorf("symlinking secrets: %w", err)
		}
	}

	// Build the compose helper.
	compose := e.newCompose(opts.App, appCfg, repoDir)

	// 6b. Generate jib override file (labels, restart policy, log rotation).
	overrideDir := e.OverrideDir
	if overrideDir == "" {
		overrideDir = docker.DefaultOverrideDir
	}
	// Determine resource limits: use configured values, or compute defaults from server resources.
	resources := appCfg.Resources
	if resources == nil {
		sr, err := platform.DetectResources()
		if err != nil {
			fmt.Fprintf(os.Stderr, "warning: could not detect server resources for default limits: %v\n", err)
		} else {
			appCount := len(e.Config.Apps)
			if appCount < 1 {
				appCount = 1
			}
			mem, cpus := platform.SuggestAppResources(sr, appCount)
			resources = &config.Resources{Memory: mem, CPUs: cpus}
		}
	}
	if _, err := docker.GenerateOverride(ctx, opts.App, []string(appCfg.Compose), repoDir, overrideDir, resources); err != nil {
		fmt.Fprintf(os.Stderr, "warning: could not generate override file: %v\n", err)
		// Non-fatal — deploy can proceed without it
	}

	// 7. Docker compose build.
	if err := compose.Build(ctx, appCfg.BuildArgs); err != nil {
		return nil, fmt.Errorf("docker compose build: %w", err)
	}

	// 8. Pre-deploy hooks.
	for _, hook := range appCfg.PreDeploy {
		if err := compose.Run(ctx, hook.Service, nil); err != nil {
			// Restore repo to previous SHA on hook failure.
			if previousSHA != "" {
				_ = gitCheckout(ctx, repoDir, previousSHA)
			}
			hookErr := fmt.Sprintf("pre_deploy hook %q failed: %v", hook.Service, err)
			e.sendNotify(ctx, opts.App, "deploy", targetRef, opts.Trigger, opts.User, "failure", hookErr)
			e.logHistory(opts.App, history.EventDeploy, targetRef, previousSHA, opts.Trigger, opts.User, "failure", hookErr, deployStart)
			return &DeployResult{
				App:         opts.App,
				PreviousSHA: previousSHA,
				DeployedSHA: "",
				Strategy:    strategy,
				Success:     false,
				Error:       hookErr,
			}, nil
		}
	}

	// 9. Docker compose up.
	if err := compose.Up(ctx, appCfg.Services); err != nil {
		return nil, fmt.Errorf("docker compose up: %w", err)
	}

	// 10-11. Wait for warmup and health check.
	healthOK := true
	var healthErr string
	if len(appCfg.Health) > 0 {
		warmup := parseWarmup(appCfg.Warmup)
		results := docker.CheckHealth(ctx, appCfg.Health, warmup)
		if !docker.AllHealthy(results) {
			healthOK = false
			var msgs []string
			for _, r := range results {
				if !r.OK {
					msgs = append(msgs, fmt.Sprintf("%s: %s", r.Endpoint, r.Error))
				}
			}
			healthErr = strings.Join(msgs, "; ")
		}
	}

	// 12. If healthcheck fails: notify, log error (don't rollback automatically).
	if !healthOK {
		e.sendNotify(ctx, opts.App, "deploy", targetRef, opts.Trigger, opts.User, "failure", "health check failed: "+healthErr)
	}

	// 13. Tag previous images as rollback.
	_ = compose.TagRollbackImages(ctx)

	// 14. Update state.
	deployedSHA, _ := gitCurrentSHA(ctx, repoDir)
	deployStatus := "success"
	deployError := ""
	if !healthOK {
		deployStatus = "failure"
		deployError = healthErr
		appState.ConsecutiveFailures++
	} else {
		appState.ConsecutiveFailures = 0
	}

	appState.App = opts.App
	appState.Strategy = strategy
	appState.PreviousSHA = previousSHA
	appState.DeployedSHA = deployedSHA
	appState.LastDeploy = time.Now()
	appState.LastDeployStatus = deployStatus
	appState.LastDeployError = deployError
	appState.LastDeployTrigger = opts.Trigger
	appState.LastDeployUser = opts.User

	if err := e.StateStore.Save(opts.App, appState); err != nil {
		return nil, fmt.Errorf("saving state: %w", err)
	}

	// 15. Lock released by defer.

	// 16. Notify success.
	if healthOK {
		e.sendNotify(ctx, opts.App, "deploy", deployedSHA, opts.Trigger, opts.User, "success", "")
	}

	// 17. Prune old images.
	_ = docker.PruneImages(ctx)

	// 18. Log event to history.
	e.logHistory(opts.App, history.EventDeploy, deployedSHA, previousSHA, opts.Trigger, opts.User, deployStatus, deployError, deployStart)

	return &DeployResult{
		App:         opts.App,
		PreviousSHA: previousSHA,
		DeployedSHA: deployedSHA,
		Strategy:    strategy,
		Success:     healthOK,
		Error:       deployError,
	}, nil
}

// newCompose creates a docker.Compose configured for the given app.
func (e *Engine) newCompose(app string, appCfg config.App, repoDir string) *docker.Compose {
	files := []string(appCfg.Compose)
	if len(files) == 0 {
		files = []string{"docker-compose.yml"}
	}

	envFile := ""
	if appCfg.SecretsEnv {
		envFile = e.Secrets.SymlinkPath(app, appCfg.EnvFile)
	}

	overrideDir := e.OverrideDir
	if overrideDir == "" {
		overrideDir = docker.DefaultOverrideDir
	}

	return &docker.Compose{
		App:      app,
		Dir:      repoDir,
		Files:    files,
		EnvFile:  envFile,
		Override: docker.OverridePath(overrideDir, app),
	}
}

// logHistory appends an event to the history log, ignoring errors.
func (e *Engine) logHistory(app, eventType, sha, previousSHA, trigger, user, status, errMsg string, start time.Time) {
	if e.History == nil {
		return
	}
	_ = e.History.Append(app, history.Event{
		Timestamp:   time.Now(),
		Type:        eventType,
		SHA:         sha,
		PreviousSHA: previousSHA,
		Trigger:     trigger,
		User:        user,
		Status:      status,
		Error:       errMsg,
		DurationMs:  time.Since(start).Milliseconds(),
	})
}

// sendNotify sends a notification event, ignoring errors.
// It uses the app's notify list if available, otherwise sends to all channels.
func (e *Engine) sendNotify(ctx context.Context, app, eventType, sha, trigger, user, status, errMsg string) {
	if e.Notifier == nil {
		return
	}

	event := notify.Event{
		App:       app,
		Type:      eventType,
		SHA:       sha,
		Trigger:   trigger,
		User:      user,
		Status:    status,
		Error:     errMsg,
		Timestamp: time.Now(),
	}

	// Use per-app routing if the app has a notify list configured.
	if appCfg, ok := e.Config.Apps[app]; ok && len(appCfg.Notify) > 0 {
		_ = e.Notifier.SendForApp(ctx, appCfg.Notify, event)
		return
	}

	// Fallback: send to all channels.
	_ = e.Notifier.Send(ctx, event)
}

// parseWarmup parses a duration string (e.g. "10s"), returning 0 on error.
func parseWarmup(s string) time.Duration {
	if s == "" {
		return 0
	}
	d, _ := time.ParseDuration(s)
	return d
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

// gitCheckout runs git checkout <ref> in the given directory.
func gitCheckout(ctx context.Context, repoDir, ref string) error {
	cmd := exec.CommandContext(ctx, "git", "checkout", ref)
	cmd.Dir = repoDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git checkout %s: %w: %s", ref, err, string(out))
	}
	return nil
}

// gitCurrentSHA runs git rev-parse HEAD and returns the current SHA.
func gitCurrentSHA(ctx context.Context, repoDir string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "rev-parse", "HEAD")
	cmd.Dir = repoDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git rev-parse HEAD: %w: %s", err, string(out))
	}
	return strings.TrimSpace(string(out)), nil
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

// checkDiskSpace checks that the filesystem containing path has at least minBytes free.
func checkDiskSpace(path string, minBytes uint64) error {
	// Use the parent directory if path doesn't exist yet.
	checkPath := path
	for {
		_, err := os.Stat(checkPath)
		if err == nil {
			break
		}
		parent := filepath.Dir(checkPath)
		if parent == checkPath {
			break
		}
		checkPath = parent
	}

	var st syscall.Statfs_t
	if err := syscall.Statfs(checkPath, &st); err != nil {
		return fmt.Errorf("statfs %s: %w", checkPath, err)
	}
	free := st.Bavail * uint64(st.Bsize)
	if free < minBytes {
		return fmt.Errorf("insufficient disk space: %d bytes free, need at least %d", free, minBytes)
	}
	return nil
}
