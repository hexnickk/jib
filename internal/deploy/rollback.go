package deploy

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/docker"
	"github.com/hexnickk/jib/internal/git"
	"github.com/hexnickk/jib/internal/history"
	"github.com/hexnickk/jib/internal/state"
)

// RollbackOptions configures a rollback invocation.
type RollbackOptions struct {
	App  string
	User string
}

// Rollback implements the restart strategy rollback flow.
// It checks out the previous SHA, reuses the rollback-tagged image if available,
// otherwise rebuilds, brings containers up, and runs health checks.
func (e *Engine) Rollback(ctx context.Context, opts RollbackOptions) (*DeployResult, error) {
	rollbackStart := time.Now()

	// Validate app exists in config.
	appCfg, ok := e.Config.Apps[opts.App]
	if !ok {
		return nil, fmt.Errorf("app %q not found in config", opts.App)
	}

	strategy := appCfg.Strategy
	if strategy == "" {
		strategy = "restart"
	}

	repoDir := RepoPath(e.RepoBaseDir, opts.App, appCfg.Repo)

	// 1. Load state, get previous_sha.
	appState, err := e.StateStore.Load(opts.App)
	if err != nil {
		return nil, fmt.Errorf("loading state: %w", err)
	}

	// 2. If no previous deploy, error.
	if appState.PreviousSHA == "" {
		return nil, fmt.Errorf("no previous deploy found for app %q", opts.App)
	}

	previousSHA := appState.PreviousSHA
	currentSHA := appState.DeployedSHA

	// 3. Acquire flock.
	lock, err := acquireLockForRollback(opts.App, e.LockDir)
	if err != nil {
		return nil, fmt.Errorf("acquiring lock: %w", err)
	}
	defer func() { _ = lock.Release() }()

	// 4. Git checkout previous_sha.
	if err := git.Checkout(ctx, repoDir, previousSHA); err != nil {
		return nil, fmt.Errorf("git checkout %s: %w", previousSHA, err)
	}

	// 5. Symlink secrets.
	if appCfg.SecretsEnv {
		if err := e.Secrets.Symlink(opts.App, repoDir, appCfg.EnvFile); err != nil {
			return nil, fmt.Errorf("symlinking secrets: %w", err)
		}
	}

	compose := e.newCompose(opts.App, appCfg, repoDir)

	// 6. Check if rollback image exists; if not, rebuild.
	rollbackTag := fmt.Sprintf("%s-%s:rollback", compose.ProjectName(), firstService(appCfg))
	if !docker.ImageExists(ctx, rollbackTag) {
		// No rollback image, must rebuild.
		if err := compose.Build(ctx, appCfg.BuildArgs); err != nil {
			return nil, fmt.Errorf("rebuilding for rollback: %w", err)
		}
	}

	// 7. Docker compose up.
	if err := compose.Up(ctx, appCfg.Services); err != nil {
		return nil, fmt.Errorf("docker compose up (rollback): %w", err)
	}

	// 8. Health check.
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

	// 9. Update state (swap deployed/previous).
	rollbackStatus := "success"
	rollbackError := ""
	if !healthOK {
		rollbackStatus = "failure"
		rollbackError = "health check failed: " + healthErr
		appState.ConsecutiveFailures++
	} else {
		appState.ConsecutiveFailures = 0
	}

	appState.App = opts.App
	appState.Strategy = strategy
	appState.DeployedSHA = previousSHA
	appState.PreviousSHA = currentSHA
	appState.LastDeploy = time.Now()
	appState.LastDeployStatus = rollbackStatus
	appState.LastDeployError = rollbackError
	appState.LastDeployTrigger = "manual"
	appState.LastDeployUser = opts.User

	if err := e.StateStore.Save(opts.App, appState); err != nil {
		return nil, fmt.Errorf("saving state: %w", err)
	}

	// 10. Notify.
	e.sendNotify(ctx, opts.App, "rollback", previousSHA, "manual", opts.User, rollbackStatus, rollbackError)

	// 11. Log event to history.
	e.logHistory(opts.App, history.EventRollback, previousSHA, currentSHA, "manual", opts.User, rollbackStatus, rollbackError, rollbackStart)

	return &DeployResult{
		App:         opts.App,
		PreviousSHA: currentSHA,
		DeployedSHA: previousSHA,
		Strategy:    strategy,
		Success:     healthOK,
		Error:       healthErr,
	}, nil
}

// firstService returns the first service name from the config, or an empty string.
// Used to construct the rollback image tag to check.
func firstService(appCfg config.App) string {
	if len(appCfg.Services) > 0 {
		return appCfg.Services[0]
	}
	return "app"
}

// acquireLockForRollback acquires a blocking lock for rollback (always blocking).
func acquireLockForRollback(app, lockDir string) (*state.Lock, error) {
	return state.Acquire(app, lockDir, true, lockTimeout)
}
