package daemon

import (
	"context"
	"crypto/tls"
	"fmt"
	"os/exec"
	"time"

	"github.com/hexnickk/jib/internal/notify"
)

// certCheckInterval is the time between cert expiry checks (daily).
const certCheckInterval = 24 * time.Hour

// certWarnDays is the number of days before expiry to send a warning.
const certWarnDays = 14

// certRenewDays is the number of days before expiry to attempt auto-renewal.
const certRenewDays = 7

// runCertWatcher periodically checks certificate expiry for all domains.
func (d *Daemon) runCertWatcher(ctx context.Context) {
	// Wait a bit before first check.
	select {
	case <-time.After(2 * time.Minute):
	case <-ctx.Done():
		return
	}

	d.logger.Println("certs: started")

	// Run check immediately, then daily.
	d.checkCerts(ctx)

	ticker := time.NewTicker(certCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			d.checkCerts(ctx)
		case <-ctx.Done():
			d.logger.Println("certs: stopped")
			return
		}
	}
}

// checkCerts checks SSL certificate expiry for all app domains.
func (d *Daemon) checkCerts(ctx context.Context) {
	cfg := d.getConfig()

	for appName, appCfg := range cfg.Apps {
		if ctx.Err() != nil {
			return
		}

		// Skip apps using tunnels — they handle TLS at the edge.
		if appCfg.IsTunnelIngress() {
			continue
		}

		for _, domain := range appCfg.Domains {
			if ctx.Err() != nil {
				return
			}

			daysLeft, err := certDaysLeft(domain.Host)
			if err != nil {
				// No cert or can't connect — not necessarily an error for
				// apps behind tunnels or without SSL.
				continue
			}

			if daysLeft <= certRenewDays {
				d.logger.Printf("certs: %s: %s expires in %d days, attempting renewal", appName, domain.Host, daysLeft)
				if err := d.renewCert(ctx, domain.Host); err != nil {
					d.logger.Printf("certs: %s/%s: renewal failed: %v", appName, domain.Host, err)
					d.notifyCert(ctx, appName, domain.Host, daysLeft, err)
				} else {
					d.logger.Printf("certs: %s: %s renewed successfully", appName, domain.Host)
				}
			} else if daysLeft <= certWarnDays {
				d.logger.Printf("certs: %s: %s expires in %d days", appName, domain.Host, daysLeft)
				d.notifyCert(ctx, appName, domain.Host, daysLeft, nil)
			}
		}
	}
}

// certDaysLeft checks a domain's TLS certificate and returns days until expiry.
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

// renewCert attempts to renew a certificate using certbot.
func (d *Daemon) renewCert(ctx context.Context, domain string) error {
	cmd := exec.CommandContext(ctx, "certbot", "renew", "--cert-name", domain, "--non-interactive") //nolint:gosec // trusted CLI subprocess
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("certbot renew: %w: %s", err, string(out))
	}
	return nil
}

// notifyCert sends a certificate expiry notification.
func (d *Daemon) notifyCert(ctx context.Context, app, domain string, daysLeft int, renewErr error) {
	if d.notifier == nil {
		return
	}

	status := "warning"
	errMsg := fmt.Sprintf("certificate for %s expires in %d days", domain, daysLeft)
	if renewErr != nil {
		status = "failure"
		errMsg += fmt.Sprintf("; renewal failed: %v", renewErr)
	}

	event := notify.Event{
		App:       app,
		Type:      "cert_expiry",
		Status:    status,
		Error:     errMsg,
		Timestamp: time.Now(),
	}

	cfg := d.getConfig()
	if appCfg, ok := cfg.Apps[app]; ok && len(appCfg.Notify) > 0 {
		_ = d.notifier.SendForApp(ctx, appCfg.Notify, event)
		return
	}
	_ = d.notifier.Send(ctx, event)
}
