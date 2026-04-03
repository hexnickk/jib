package main

import (
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/hexnickk/jib/internal/bus"
	"github.com/hexnickk/jib/internal/config"
)

const heartbeatInterval = 30 * time.Second

var version = "dev"

func main() {
	logger := log.New(os.Stderr, "[heartbeat] ", log.LstdFlags)
	logger.Printf("starting jib-heartbeat %s", version)

	root := os.Getenv("JIB_ROOT")
	if root == "" {
		root = "/opt/jib"
	}
	cfgPath := filepath.Join(root, "config.yml")

	cfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		logger.Fatalf("loading config: %v", err)
	}

	b := bus.ConnectWithRetry(bus.Options{URL: bus.DefaultURL}, logger)
	defer b.Close()

	svc := &service{
		cfgPath:   cfgPath,
		cfg:       cfg,
		bus:       b,
		logger:    logger,
		startTime: time.Now(),
	}

	// Config reload (fan-out)
	if _, err := b.Subscribe(bus.TopicConfigReload, svc.handleConfigReload); err != nil {
		logger.Fatalf("subscribing to config reload: %v", err)
	}

	logger.Println("ready")

	// Publish first heartbeat immediately
	svc.publishHeartbeat()

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	sigCh := make(chan os.Signal, 2)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

	for {
		select {
		case <-ticker.C:
			svc.publishHeartbeat()
		case <-sigCh:
			logger.Println("stopped")
			return
		}
	}
}

type service struct {
	cfgPath   string
	logger    *log.Logger
	bus       *bus.Bus
	startTime time.Time

	mu  sync.RWMutex
	cfg *config.Config
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

func (s *service) publishHeartbeat() {
	s.mu.RLock()
	cfg := s.cfg
	s.mu.RUnlock()

	apps := make([]string, 0, len(cfg.Apps))
	for name := range cfg.Apps {
		apps = append(apps, name)
	}

	hb := bus.Heartbeat{
		Message: bus.NewMessage("heartbeat"),
		Apps:    apps,
		Uptime:  int64(time.Since(s.startTime).Seconds()),
	}
	if err := s.bus.Publish(hb.Subject(), hb); err != nil {
		s.logger.Printf("publish heartbeat: %v", err)
	}
}
