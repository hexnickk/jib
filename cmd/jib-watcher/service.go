package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/hexnickk/jib/internal/bus"
	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/deployrpc"
	"github.com/hexnickk/jib/internal/git"
	"github.com/hexnickk/jib/internal/module"
	"github.com/hexnickk/jib/internal/module/ghmod"
	"github.com/hexnickk/jib/internal/state"
)

// runService is the service entry point invoked by main when the binary is
// started with the "run" subcommand (i.e. by systemd).
func runService() {
	logger := log.New(os.Stderr, "[watcher] ", log.LstdFlags)
	logger.Printf("starting jib-watcher %s", version)

	cfgPath := config.ConfigFile()

	cfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		logger.Fatalf("loading config: %v", err)
	}

	// Register GitHub auth module so GitAuthProviders() works.
	module.Register(&ghmod.Module{})

	b := bus.ConnectWithRetry(bus.Options{URL: bus.DefaultURL}, logger)
	defer b.Close()

	svc := &service{
		cfgPath: cfgPath,
		cfg:     cfg,
		bus:     b,
		state:   state.NewStore(config.StateDir()),
		logger:  logger,
	}

	// Config reload (fan-out — regular Subscribe, not queue).
	if _, err := b.Subscribe(bus.TopicConfigReload, svc.handleConfigReload); err != nil {
		logger.Fatalf("subscribing to config reload: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		<-sigCh
		logger.Println("shutting down...")
		cancel()
	}()

	logger.Println("ready")
	svc.runPoller(ctx)
	logger.Println("stopped")
}

type service struct {
	cfgPath string
	logger  *log.Logger
	bus     *bus.Bus
	state   *state.Store

	mu  sync.RWMutex
	cfg *config.Config
}

func (s *service) getConfig() *config.Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

func (s *service) parsePollInterval() time.Duration {
	cfg := s.getConfig()
	dur, err := time.ParseDuration(cfg.PollInterval)
	if err != nil || dur <= 0 {
		return 5 * time.Minute
	}
	return dur
}

func (s *service) handleConfigReload(_ string, _ []byte) error {
	cfg, err := config.LoadConfig(s.cfgPath)
	if err != nil {
		s.logger.Printf("config reload failed: %v", err)
		return err
	}
	s.mu.Lock()
	s.cfg = cfg
	s.mu.Unlock()
	s.logger.Println("config reloaded")
	return nil
}

func (s *service) runPoller(ctx context.Context) {
	// Initial delay to let things settle.
	select {
	case <-time.After(10 * time.Second):
	case <-ctx.Done():
		return
	}

	s.logger.Println("polling started")
	for {
		interval := s.parsePollInterval()
		s.pollOnce(ctx)
		select {
		case <-time.After(interval):
		case <-ctx.Done():
			s.logger.Println("polling stopped")
			return
		}
	}
}

func (s *service) pollOnce(ctx context.Context) {
	cfg := s.getConfig()
	for appName, appCfg := range cfg.Apps {
		if ctx.Err() != nil {
			return
		}

		// Skip apps with no remote (local repos).
		if appCfg.Repo == "local" || appCfg.Repo == "" {
			continue
		}

		appState, err := s.state.Load(appName)
		if err != nil {
			s.logger.Printf("%s: error loading state: %v", appName, err)
			continue
		}
		if appState.Pinned {
			continue
		}
		if appState.ConsecutiveFailures >= 3 {
			s.logger.Printf("%s: skipping (consecutive failures: %d)", appName, appState.ConsecutiveFailures)
			continue
		}

		branch := appCfg.Branch
		if branch == "" {
			branch = "main"
		}

		repoDir := config.RepoPath(appName, appCfg.Repo)
		if _, err := os.Stat(repoDir); os.IsNotExist(err) {
			continue
		}
		if !git.HasRemote(ctx, repoDir) {
			continue
		}

		// Refresh auth via registered GitAuthProviders before fetch.
		authFailed := false
		for _, gap := range module.GitAuthProviders() {
			handled, err := gap.RefreshAuth(ctx, config.Root(), repoDir, appCfg, cfg)
			if err != nil {
				s.logger.Printf("%s: %s auth refresh error: %v", appName, gap.Name(), err)
				authFailed = true
				break
			}
			if handled {
				break
			}
		}
		if authFailed {
			continue
		}

		if err := git.Fetch(ctx, repoDir, branch); err != nil {
			s.logger.Printf("%s: fetch error: %v", appName, err)
			continue
		}

		remoteSHA, err := git.RemoteSHA(ctx, repoDir, branch)
		if err != nil {
			s.logger.Printf("%s: error getting remote SHA: %v", appName, err)
			continue
		}

		if remoteSHA == appState.DeployedSHA {
			continue
		}

		s.logger.Printf("%s: new commit detected %s (was %s)", appName, shortSHA(remoteSHA), shortSHA(appState.DeployedSHA))

		// Publish deploy command via NATS instead of deploying directly.
		cmd := deployrpc.DeployCommand{
			Message: bus.NewMessage("watcher"),
			App:     appName,
			Trigger: "autodeploy",
			User:    "autodeploy",
		}
		if err := s.bus.Publish(cmd.Subject(), cmd); err != nil {
			s.logger.Printf("%s: publish deploy command: %v", appName, err)
		}
	}
}

func shortSHA(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}
