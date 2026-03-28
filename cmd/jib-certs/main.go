// Command jib-certs is a standalone certificate expiry monitor.
// It periodically checks TLS cert expiry for all app domains
// and publishes events to NATS when certs are nearing expiry.
package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hexnickk/jib/internal/bus"
	"github.com/hexnickk/jib/internal/config"
)

const (
	checkInterval = 24 * time.Hour
	warnDays      = 14
	renewDays     = 7
)

func main() {
	logger := log.New(os.Stderr, "[certs] ", log.LstdFlags)

	configPath := envOr("JIB_CONFIG", "/opt/jib/config.yml")
	natsURL := envOr("NATS_URL", bus.DefaultURL)
	natsUser := os.Getenv("NATS_USER")
	natsPass := os.Getenv("NATS_PASS")

	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		logger.Fatalf("loading config: %v", err)
	}

	b, err := bus.Connect(bus.Options{
		URL:      natsURL,
		User:     natsUser,
		Password: natsPass,
	}, logger)
	if err != nil {
		logger.Fatalf("connecting to NATS: %v", err)
	}
	defer b.Close()

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	watcher := &certWatcher{
		cfg:    cfg,
		bus:    b,
		logger: logger,
	}

	logger.Println("started")

	// Wait before first check.
	select {
	case <-time.After(2 * time.Minute):
	case <-ctx.Done():
		return
	}

	watcher.checkAll(ctx)

	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			watcher.checkAll(ctx)
		case <-ctx.Done():
			logger.Println("stopped")
			return
		}
	}
}

type certWatcher struct {
	cfg    *config.Config
	bus    *bus.Bus
	logger *log.Logger
}

func (w *certWatcher) checkAll(ctx context.Context) {
	for appName, appCfg := range w.cfg.Apps {
		if ctx.Err() != nil {
			return
		}
		for _, domain := range appCfg.Domains {
			if ctx.Err() != nil {
				return
			}
			if domain.IsTunnelIngress() {
				continue
			}

			daysLeft, err := certDaysLeft(domain.Host)
			if err != nil {
				continue // no cert or can't connect
			}

			if daysLeft <= renewDays {
				w.logger.Printf("%s: %s expires in %d days, requesting renewal", appName, domain.Host, daysLeft)
				w.publishCertEvent(domain.Host, daysLeft, "")
				w.publishRenewCommand(domain.Host)
			} else if daysLeft <= warnDays {
				w.logger.Printf("%s: %s expires in %d days", appName, domain.Host, daysLeft)
				w.publishCertEvent(domain.Host, daysLeft, "")
			}
		}
	}
}

func (w *certWatcher) publishCertEvent(domain string, daysLeft int, errMsg string) {
	ev := bus.CertEvent{
		Message:  bus.NewMessage("certs"),
		Domain:   domain,
		DaysLeft: daysLeft,
		Error:    errMsg,
	}
	if err := w.bus.Publish(ev.Subject(), ev); err != nil {
		w.logger.Printf("publish error: %v", err)
	}
}

func (w *certWatcher) publishRenewCommand(domain string) {
	cmd := bus.CertRenewCommand{
		Message: bus.NewMessage("certs"),
		Domain:  domain,
	}
	if err := w.bus.Publish(cmd.Subject(), cmd); err != nil {
		w.logger.Printf("publish renew command error: %v", err)
	}
}

func certDaysLeft(host string) (int, error) {
	dialer := &tls.Dialer{
		Config: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // intentional: checking cert expiry requires connecting without verification
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := dialer.DialContext(ctx, "tcp", host+":443")
	if err != nil {
		return 0, fmt.Errorf("connecting to %s:443: %w", host, err)
	}
	defer func() { _ = conn.Close() }()

	tlsConn, ok := conn.(*tls.Conn)
	if !ok {
		return 0, fmt.Errorf("not a TLS connection for %s", host)
	}

	certs := tlsConn.ConnectionState().PeerCertificates
	if len(certs) == 0 {
		return 0, fmt.Errorf("no certificates returned for %s", host)
	}

	expiry := certs[0].NotAfter
	days := int(time.Until(expiry).Hours() / 24)
	return days, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
