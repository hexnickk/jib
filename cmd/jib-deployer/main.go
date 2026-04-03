package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/hexnickk/jib/internal/bus"
	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/deploy"
	"github.com/hexnickk/jib/internal/history"
	"github.com/hexnickk/jib/internal/proxy"
	"github.com/hexnickk/jib/internal/secrets"
	"github.com/hexnickk/jib/internal/state"
)

func main() {
	logger := log.New(os.Stderr, "[deployer] ", log.LstdFlags)

	root := os.Getenv("JIB_ROOT")
	if root == "" {
		root = "/opt/jib"
	}

	cfgPath := filepath.Join(root, "config.yml")

	cfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		logger.Fatalf("loading config: %v", err)
	}

	svc := &service{
		root:    root,
		cfgPath: cfgPath,
		logger:  logger,
	}
	svc.rebuild(cfg)

	b := bus.ConnectWithRetry(bus.Options{URL: bus.DefaultURL}, logger)
	defer b.Close()
	svc.bus = b

	// Queue group "deployer" for load-balanced command handling.
	if _, err := b.QueueSubscribeReply(bus.TopicDeployCmd+".>", "deployer", svc.handleDeploy); err != nil {
		logger.Fatalf("subscribing to deploy commands: %v", err)
	}
	if _, err := b.QueueSubscribeReply(bus.TopicRollbackCmd+".>", "deployer", svc.handleRollback); err != nil {
		logger.Fatalf("subscribing to rollback commands: %v", err)
	}
	if _, err := b.QueueSubscribeReply(bus.TopicResumeCmd+".>", "deployer", svc.handleResume); err != nil {
		logger.Fatalf("subscribing to resume commands: %v", err)
	}

	// Config reload is fan-out (regular Subscribe, not queue).
	if _, err := b.Subscribe(bus.TopicConfigReload, svc.handleConfigReload); err != nil {
		logger.Fatalf("subscribing to config reload: %v", err)
	}

	logger.Println("ready")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	svc.ctx = ctx

	sigCh := make(chan os.Signal, 2)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	<-sigCh
	logger.Println("shutting down...")
	cancel()
	svc.wg.Wait()
	logger.Println("stopped")
}

type service struct {
	root    string
	cfgPath string
	logger  *log.Logger
	bus     *bus.Bus
	ctx     context.Context
	wg      sync.WaitGroup

	mu         sync.RWMutex
	cfg        *config.Config
	stateStore *state.Store
	secrets    *secrets.Manager
	proxyMgr   proxy.Proxy
	historyLog *history.Logger
}

func (s *service) rebuild(cfg *config.Config) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg = cfg
	s.stateStore = state.NewStore(filepath.Join(s.root, "state"))
	s.secrets = secrets.NewManager(filepath.Join(s.root, "secrets"))
	s.historyLog = history.NewLogger(filepath.Join(s.root, "logs"))
	s.proxyMgr = proxy.NewNginx(
		filepath.Join(s.root, "nginx"),
		"/etc/nginx/conf.d",
	)
}

func (s *service) newEngine() *deploy.Engine {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return &deploy.Engine{
		Config:      s.cfg,
		StateStore:  s.stateStore,
		Secrets:     s.secrets,
		Proxy:       s.proxyMgr,
		History:     s.historyLog,
		LockDir:     filepath.Join(s.root, "locks"),
		RepoBaseDir: filepath.Join(s.root, "repos"),
		OverrideDir: filepath.Join(s.root, "overrides"),
		JibRoot:     s.root,
	}
}

func (s *service) handleDeploy(subject string, data []byte) (any, error) {
	var cmd bus.DeployCommand
	if err := json.Unmarshal(data, &cmd); err != nil {
		return bus.CommandAck{Accepted: false, Error: "invalid payload"}, nil
	}
	if cmd.App == "" {
		cmd.App = extractApp(subject)
	}
	if err := cmd.Validate(); err != nil {
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: err.Error()}, nil
	}

	// Non-blocking lock probe for dedup.
	lock, err := state.Acquire(cmd.App, filepath.Join(s.root, "locks"), false, 0)
	if err != nil {
		if errors.Is(err, state.ErrLockBusy) {
			return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: "deploy already in progress"}, nil
		}
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: err.Error()}, nil
	}
	_ = lock.Release()

	// ACK immediately, execute in background.
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		engine := s.newEngine()
		start := time.Now()
		result, deployErr := engine.Deploy(s.ctx, deploy.DeployOptions{
			App:     cmd.App,
			Ref:     cmd.Ref,
			Trigger: cmd.Trigger,
			User:    cmd.User,
			Force:   cmd.Force,
			DryRun:  cmd.DryRun,
		})
		duration := time.Since(start)
		if deployErr != nil {
			s.logger.Printf("deploy %s error: %v", cmd.App, deployErr)
			s.publishDeployEvent(&deploy.DeployResult{
				App: cmd.App, Success: false, Error: deployErr.Error(),
			}, cmd.Trigger, cmd.User, cmd.ID, duration)
			return
		}
		s.publishDeployEvent(result, cmd.Trigger, cmd.User, cmd.ID, duration)
		if result.Success {
			s.logger.Printf("deployed %s → %s", cmd.App, shortSHA(result.DeployedSHA))
		} else {
			s.logger.Printf("deploy %s failed: %s", cmd.App, result.Error)
		}
	}()

	return bus.CommandAck{Accepted: true, CorrelationID: cmd.ID}, nil
}

func (s *service) handleRollback(subject string, data []byte) (any, error) {
	var cmd bus.RollbackCommand
	if err := json.Unmarshal(data, &cmd); err != nil {
		return bus.CommandAck{Accepted: false, Error: "invalid payload"}, nil
	}
	if cmd.App == "" {
		cmd.App = extractApp(subject)
	}
	if err := cmd.Validate(); err != nil {
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: err.Error()}, nil
	}

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		engine := s.newEngine()
		start := time.Now()
		result, err := engine.Rollback(s.ctx, deploy.RollbackOptions{
			App:  cmd.App,
			User: cmd.User,
		})
		duration := time.Since(start)
		if err != nil {
			s.logger.Printf("rollback %s error: %v", cmd.App, err)
			s.publishDeployEvent(&deploy.DeployResult{
				App: cmd.App, Success: false, Error: err.Error(),
			}, "rollback", cmd.User, cmd.ID, duration)
			return
		}
		s.publishDeployEvent(result, "rollback", cmd.User, cmd.ID, duration)
	}()

	return bus.CommandAck{Accepted: true, CorrelationID: cmd.ID}, nil
}

func (s *service) handleResume(subject string, data []byte) (any, error) {
	var cmd bus.ResumeCommand
	if err := json.Unmarshal(data, &cmd); err != nil {
		return bus.CommandAck{Accepted: false, Error: "invalid payload"}, nil
	}
	if cmd.App == "" {
		cmd.App = extractApp(subject)
	}
	if err := cmd.Validate(); err != nil {
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: err.Error()}, nil
	}

	s.mu.RLock()
	store := s.stateStore
	s.mu.RUnlock()

	appState, err := store.Load(cmd.App)
	if err != nil {
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: fmt.Sprintf("loading state: %v", err)}, nil
	}
	appState.Pinned = false
	appState.ConsecutiveFailures = 0
	if err := store.Save(cmd.App, appState); err != nil {
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: fmt.Sprintf("saving state: %v", err)}, nil
	}

	s.logger.Printf("resumed %s: pinned=false, failures=0", cmd.App)
	return bus.CommandAck{Accepted: true, CorrelationID: cmd.ID}, nil
}

func (s *service) handleConfigReload(_ string, _ []byte) error {
	cfg, err := config.LoadConfig(s.cfgPath)
	if err != nil {
		s.logger.Printf("config reload failed: %v", err)
		return err
	}
	s.rebuild(cfg)
	s.logger.Println("config reloaded")
	return nil
}

func (s *service) publishDeployEvent(result *deploy.DeployResult, trigger, user, correlationID string, duration time.Duration) {
	status := bus.StatusSuccess
	if !result.Success {
		status = bus.StatusFailure
	}
	ev := bus.DeployEvent{
		Message:     bus.NewCorrelated("deployer", correlationID),
		App:         result.App,
		SHA:         result.DeployedSHA,
		PreviousSHA: result.PreviousSHA,
		Strategy:    result.Strategy,
		Status:      status,
		Trigger:     trigger,
		User:        user,
		Error:       result.Error,
		DurationMs:  duration.Milliseconds(),
	}
	if err := s.bus.Publish(ev.Subject(), ev); err != nil {
		s.logger.Printf("publish deploy event: %v", err)
	}
}

func extractApp(subject string) string {
	parts := strings.Split(subject, ".")
	if len(parts) < 4 {
		return ""
	}
	return parts[len(parts)-1]
}

func shortSHA(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}
