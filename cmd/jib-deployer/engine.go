package main

import (
	"fmt"
	"os"
	"time"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/history"
	"github.com/hexnickk/jib/internal/secrets"
	"github.com/hexnickk/jib/internal/state"
)

// lockTimeout is the maximum time to wait for a deploy lock in blocking mode.
const lockTimeout = 5 * time.Minute

// Engine orchestrates deploys and rollbacks.
type Engine struct {
	Config      *config.Config
	StateStore  *state.Store
	Secrets     *secrets.Manager
	History     *history.Logger
	Docker      DockerClient
	LockDir     string
	RepoBaseDir string // e.g. /opt/jib/repos
	OverrideDir string // e.g. /opt/jib/overrides
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

// newCompose creates a Compose configured for the given app. Resolves
// defaults (compose files, env file, override dir) and delegates the actual
// construction to the DockerClient so tests can substitute a fake.
func (e *Engine) newCompose(app string, appCfg config.App, repoDir string) Compose {
	files := []string(appCfg.Compose)
	if len(files) == 0 {
		files = []string{"docker-compose.yml"}
	}

	envFile := ""
	if exists, _ := e.Secrets.Check(app, appCfg.EnvFile); exists {
		envFile = e.Secrets.SymlinkPath(app, appCfg.EnvFile)
	}

	overrideDir := e.OverrideDir
	if overrideDir == "" {
		overrideDir = config.OverrideDir()
	}

	return e.Docker.NewCompose(app, repoDir, files, envFile, e.Docker.OverridePath(overrideDir, app))
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
