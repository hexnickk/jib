// Package deploy implements the core deploy and rollback orchestration for Jib.
package deploy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/docker"
	"github.com/hexnickk/jib/internal/git"
	ghPkg "github.com/hexnickk/jib/internal/github"
	"github.com/hexnickk/jib/internal/history"
	"github.com/hexnickk/jib/internal/proxy"
	"github.com/hexnickk/jib/internal/secrets"
	"github.com/hexnickk/jib/internal/state"
)

// minDiskBytes is the minimum free disk space required to deploy (2 GB).
const minDiskBytes uint64 = 2 * 1024 * 1024 * 1024

// lockTimeout is the maximum time to wait for a deploy lock in blocking mode.
const lockTimeout = 5 * time.Minute

// RepoPath returns the on-disk path for an app's git checkout.
// GitHub repos (org/name) go under repos/github/org/name.
// Local repos go under repos/local/<appName>.
func RepoPath(repoBaseDir, appName, repo string) string {
	if repo == "local" || repo == "" {
		return filepath.Join(repoBaseDir, "local", appName)
	}
	return filepath.Join(repoBaseDir, "github", repo)
}

// Engine orchestrates deploys and rollbacks.
type Engine struct {
	Config      *config.Config
	StateStore  *state.Store
	Secrets     *secrets.Manager
	Proxy       proxy.Proxy
	History     *history.Logger
	LockDir     string
	RepoBaseDir string // e.g. /opt/jib/repos
	OverrideDir string // e.g. /opt/jib/overrides
	JibRoot     string // e.g. /opt/jib (needed for provider key paths)
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

	repoDir := RepoPath(e.RepoBaseDir, opts.App, appCfg.Repo)
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
	hasRemote := git.HasRemote(ctx, repoDir)
	if hasRemote {
		// For GitHub App providers, refresh the installation token before fetch.
		if err := e.refreshFetchAuth(ctx, appCfg, repoDir); err != nil {
			return nil, fmt.Errorf("refreshing auth: %w", err)
		}
		if err := git.Fetch(ctx, repoDir, branch); err != nil {
			return nil, fmt.Errorf("git fetch: %w", err)
		}
	}

	targetRef := opts.Ref
	if targetRef == "" {
		if hasRemote {
			remoteSHA, err := git.RemoteSHA(ctx, repoDir, branch)
			if err != nil {
				return nil, fmt.Errorf("resolving remote HEAD: %w", err)
			}
			targetRef = remoteSHA
		} else {
			// Local-only repo: use current HEAD
			localSHA, err := git.CurrentSHA(ctx, repoDir)
			if err != nil {
				return nil, fmt.Errorf("resolving local HEAD: %w", err)
			}
			targetRef = localSHA
		}
	}

	// Check if already at target SHA (skip unless --force).
	currentSHA, _ := git.CurrentSHA(ctx, repoDir)
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
		fmt.Printf("[dry-run] %s (%s strategy)\n", opts.App, strategy)
		fmt.Printf("[dry-run]   Current SHA: %s\n", currentSHA)
		fmt.Printf("[dry-run]   Target SHA:  %s\n", targetRef)
		if len(appCfg.PreDeploy) > 0 {
			fmt.Printf("[dry-run]   Pre-deploy hooks:\n")
			for _, h := range appCfg.PreDeploy {
				fmt.Printf("[dry-run]     - %s\n", h.Service)
			}
		}
		if len(appCfg.BuildArgs) > 0 {
			fmt.Printf("[dry-run]   Build args:\n")
			for k, v := range appCfg.BuildArgs {
				fmt.Printf("[dry-run]     %s=%s\n", k, v)
			}
		}
		if len(appCfg.Services) > 0 {
			fmt.Printf("[dry-run]   Services: %s\n", strings.Join(appCfg.Services, ", "))
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
	if err := git.Checkout(ctx, repoDir, targetRef); err != nil {
		return nil, fmt.Errorf("git checkout: %w", err)
	}

	// 6. Symlink secrets .env into repo.
	if appCfg.SecretsEnv {
		if err := e.Secrets.Symlink(opts.App, repoDir, appCfg.EnvFile); err != nil {
			return nil, fmt.Errorf("symlinking secrets: %w", err)
		}
	}

	// 6b. Generate compose file for Dockerfile-only repos.
	overrideDir := e.OverrideDir
	if overrideDir == "" {
		overrideDir = docker.DefaultOverrideDir
	}
	if docker.NeedsGeneratedCompose(repoDir, []string(appCfg.Compose)) {
		fmt.Printf("[deploy] No docker-compose.yml found, generating from Dockerfile...\n")
		composePath, hostPort, err := docker.GenerateComposeForDockerfile(opts.App, repoDir, overrideDir, 0)
		if err != nil {
			return nil, fmt.Errorf("generating compose from Dockerfile: %w", err)
		}
		appCfg.Compose = config.StringOrSlice{composePath}
		fmt.Printf("[deploy] Generated compose: port %d -> container\n", hostPort)

		// Update domain ports if not yet assigned.
		for i := range appCfg.Domains {
			if appCfg.Domains[i].Port == 0 {
				appCfg.Domains[i].Port = hostPort
			}
		}
		// Update health check ports if not yet assigned.
		for i := range appCfg.Health {
			if appCfg.Health[i].Port == 0 {
				appCfg.Health[i].Port = hostPort
			}
		}
	}

	// Build the compose helper.
	compose := e.newCompose(opts.App, appCfg, repoDir)

	// 6c. Generate jib override file (labels, restart policy, log rotation).
	if _, err := docker.GenerateOverride(ctx, opts.App, []string(appCfg.Compose), repoDir, overrideDir); err != nil {
		fmt.Fprintf(os.Stderr, "warning: could not generate override file: %v\n", err)
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
				_ = git.Checkout(ctx, repoDir, previousSHA)
			}
			hookErr := fmt.Sprintf("pre_deploy hook %q failed: %v", hook.Service, err)

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

	// 13. Tag previous images as rollback.
	if err := compose.TagRollbackImages(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "warning: tagging rollback images: %v\n", err)
	}

	// 14. Update state.
	deployedSHA, _ := git.CurrentSHA(ctx, repoDir)
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

	// 16. Prune old images.
	if err := docker.PruneImages(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "warning: pruning images: %v\n", err)
	}

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

// logHistory appends an event to the history log, logging errors to stderr.
func (e *Engine) logHistory(app, eventType, sha, previousSHA, trigger, user, status, errMsg string, start time.Time) {
	if e.History == nil {
		return
	}
	if err := e.History.Append(app, history.Event{
		Timestamp:   time.Now(),
		Type:        eventType,
		SHA:         sha,
		PreviousSHA: previousSHA,
		Trigger:     trigger,
		User:        user,
		Status:      status,
		Error:       errMsg,
		DurationMs:  time.Since(start).Milliseconds(),
	}); err != nil {
		fmt.Fprintf(os.Stderr, "warning: history: %v\n", err)
	}
}

// parseWarmup parses a duration string (e.g. "10s"), returning 0 on error.
func parseWarmup(s string) time.Duration {
	if s == "" {
		return 0
	}
	d, _ := time.ParseDuration(s)
	return d
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
	free := st.Bavail * uint64(st.Bsize) //nolint:gosec // Bsize is always positive, int64->uint64 overflow not possible
	if free < minBytes {
		return fmt.Errorf("insufficient disk space: %d bytes free, need at least %d", free, minBytes)
	}
	return nil
}

// refreshFetchAuth sets up authentication for the next git fetch.
// For GitHub App providers, this generates a fresh installation token and
// updates the remote URL. For key providers, no action is needed (SSH key
// is already configured in the repo's git config).
func (e *Engine) refreshFetchAuth(ctx context.Context, appCfg config.App, repoDir string) error {
	if appCfg.Provider == "" {
		return nil // legacy key-based or local, already configured
	}
	provider, ok := e.Config.LookupProvider(appCfg.Provider)
	if !ok {
		return nil // provider not found, will fail on fetch anyway
	}
	if provider.Type != ghPkg.ProviderTypeApp {
		return nil // key providers use core.sshCommand, no refresh needed
	}

	token, err := ghPkg.GenerateInstallationToken(ctx, e.JibRoot, appCfg.Provider, provider.AppID, appCfg.Repo)
	if err != nil {
		return fmt.Errorf("generating installation token: %w", err)
	}
	return ghPkg.SetRemoteToken(ctx, repoDir, appCfg.Repo, token)
}
