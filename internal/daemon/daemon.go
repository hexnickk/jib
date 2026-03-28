// Package daemon implements the always-running jib background service.
// It handles autodeploy polling, incoming webhooks, scheduled backups,
// and health monitoring. Installed as a systemd service by `jib init`.
package daemon

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/hexnickk/jib/internal/backup"
	"github.com/hexnickk/jib/internal/bus"
	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/deploy"
	"github.com/hexnickk/jib/internal/history"
	"github.com/hexnickk/jib/internal/notify"
	"github.com/hexnickk/jib/internal/proxy"
	"github.com/hexnickk/jib/internal/secrets"
	"github.com/hexnickk/jib/internal/ssl"
	"github.com/hexnickk/jib/internal/state"
)

// Daemon is the main daemon process that coordinates all background subsystems.
type Daemon struct {
	Root       string // e.g. /opt/jib
	ConfigPath string

	mu     sync.RWMutex
	config *config.Config

	stateStore *state.Store
	secrets    *secrets.Manager
	notifier   *notify.Multi
	proxyMgr   proxy.Proxy
	sslMgr     *ssl.CertManager
	historyLog *history.Logger
	backupMgr  *backup.Manager

	bus       *bus.Bus        // nil if NATS is unavailable
	ctx       context.Context // daemon lifecycle context, used by background tasks
	startTime time.Time
	logger    *log.Logger
}

// New creates a new Daemon.
func New(root, configPath string) *Daemon {
	return &Daemon{
		Root:       root,
		ConfigPath: configPath,
		logger:     log.New(os.Stderr, "[daemon] ", log.LstdFlags),
	}
}

// Run starts all daemon subsystems and blocks until ctx is cancelled or a
// termination signal is received. It writes a PID file on start and removes
// it on shutdown.
func (d *Daemon) Run(ctx context.Context) error {
	// Load initial config.
	if err := d.loadConfig(); err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	// Write PID file.
	pidPath := filepath.Join(d.Root, "jib.pid")
	if err := d.writePID(pidPath); err != nil {
		return fmt.Errorf("writing PID file: %w", err)
	}
	defer func() { _ = os.Remove(pidPath) }()

	d.startTime = time.Now()
	d.logger.Printf("daemon started (pid %d)", os.Getpid())

	// Connect to NATS (optional — daemon works without it).
	b, err := bus.Connect(bus.Options{URL: bus.DefaultURL}, d.logger)
	if err != nil {
		d.logger.Printf("warning: NATS unavailable, events will not be published: %v", err)
	} else {
		d.bus = b
		defer d.bus.Close()
	}

	// Create a cancellable context for subsystems.
	// (must be set before subscribeCommands which launches goroutines using d.ctx)
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	d.ctx = ctx

	// Subscribe to NATS commands.
	if err := d.subscribeCommands(); err != nil {
		d.logger.Printf("warning: NATS command subscription failed: %v", err)
	}

	// Signal handling: SIGTERM/SIGINT cancel context, SIGHUP reloads config.
	sigCh := make(chan os.Signal, 4)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	defer signal.Stop(sigCh)

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case sig := <-sigCh:
				switch sig {
				case syscall.SIGHUP:
					d.logger.Println("received SIGHUP, reloading config")
					if err := d.loadConfig(); err != nil {
						d.logger.Printf("config reload failed: %v", err)
					} else {
						d.logger.Println("config reloaded")
					}
				case syscall.SIGTERM, syscall.SIGINT:
					d.logger.Printf("received %s, shutting down", sig)
					cancel()
					return
				}
			}
		}
	}()

	// Start subsystems.
	var wg sync.WaitGroup

	// 1. Git poller.
	wg.Add(1)
	go func() {
		defer wg.Done()
		d.runPoller(ctx)
	}()

	// 2. Backup scheduler.
	wg.Add(1)
	go func() {
		defer wg.Done()
		d.runScheduler(ctx)
	}()

	// 3. Health monitor.
	wg.Add(1)
	go func() {
		defer wg.Done()
		d.runHealthMonitor(ctx)
	}()

	// 4. Cert watcher.
	wg.Add(1)
	go func() {
		defer wg.Done()
		d.runCertWatcher(ctx)
	}()

	// 5. Heartbeat (only if NATS connected).
	if d.bus != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			d.runHeartbeat(ctx)
		}()
	}

	// Block until context is cancelled.
	<-ctx.Done()
	d.logger.Println("waiting for subsystems to stop...")
	wg.Wait()
	d.logger.Println("daemon stopped")
	return nil
}

// loadConfig loads (or reloads) the configuration and rebuilds all internal
// managers/clients that depend on it.
func (d *Daemon) loadConfig() error {
	cfg, err := config.LoadConfig(d.ConfigPath)
	if err != nil {
		return err
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	d.config = cfg

	// Rebuild managers.
	d.stateStore = state.NewStore(filepath.Join(d.Root, "state"))
	d.secrets = secrets.NewManager(filepath.Join(d.Root, "secrets"))
	d.historyLog = history.NewLogger(filepath.Join(d.Root, "logs"))
	d.backupMgr = backup.NewManager(cfg, filepath.Join(d.Root, "backups"))
	d.sslMgr = ssl.NewCertManager(cfg.CertbotEmail, "/var/www/certbot")

	webhookPort := 0
	if cfg.Webhook != nil {
		webhookPort = cfg.Webhook.Port
	}
	d.proxyMgr = proxy.NewNginx(
		filepath.Join(d.Root, "nginx"),
		"/etc/nginx/conf.d",
		webhookPort,
	)

	// Build notifier.
	secretsDir := filepath.Join(d.Root, "secrets")
	if len(cfg.Notifications) > 0 {
		channels := make(map[string]notify.ChannelConfig, len(cfg.Notifications))
		for name, ch := range cfg.Notifications {
			channels[name] = notify.ChannelConfig{Driver: ch.Driver}
		}
		d.notifier = notify.LoadChannels(secretsDir, channels)
	} else {
		d.notifier = notify.LoadFromSecrets(secretsDir)
	}

	return nil
}

// getConfig returns the current config under a read lock.
func (d *Daemon) getConfig() *config.Config {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.config
}

// newEngine builds a deploy.Engine from the current daemon state.
func (d *Daemon) newEngine() *deploy.Engine {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return &deploy.Engine{
		Config:      d.config,
		StateStore:  d.stateStore,
		Secrets:     d.secrets,
		Notifier:    d.notifier,
		Proxy:       d.proxyMgr,
		SSL:         d.sslMgr,
		History:     d.historyLog,
		LockDir:     filepath.Join(d.Root, "locks"),
		RepoBaseDir: filepath.Join(d.Root, "repos"),
		OverrideDir: filepath.Join(d.Root, "overrides"),
	}
}

// writePID writes the current process ID to the given path.
func (d *Daemon) writePID(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(strconv.Itoa(os.Getpid())+"\n"), 0o600)
}

// parsePollInterval parses the poll_interval config value, defaulting to 5m.
func (d *Daemon) parsePollInterval() time.Duration {
	cfg := d.getConfig()
	dur, err := time.ParseDuration(cfg.PollInterval)
	if err != nil || dur <= 0 {
		return 5 * time.Minute
	}
	return dur
}
