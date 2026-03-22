package ssl

import (
	"context"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const defaultCertBase = "/etc/letsencrypt/live"

// CertManager wraps certbot operations for obtaining and inspecting
// Let's Encrypt TLS certificates.
type CertManager struct {
	Email   string // certbot registration email
	Webroot string // webroot path, e.g. /var/www/certbot

	// certBase is the directory under which per-domain certificate
	// directories are stored. It defaults to /etc/letsencrypt/live and
	// exists primarily so tests can redirect reads to a temp directory.
	certBase string
}

// NewCertManager returns a CertManager configured with the given email and
// webroot directory.
func NewCertManager(email, webroot string) *CertManager {
	return &CertManager{
		Email:    email,
		Webroot:  webroot,
		certBase: defaultCertBase,
	}
}

// CertPath returns the path to the fullchain certificate for domain.
func (cm *CertManager) CertPath(domain string) string {
	return filepath.Join(cm.certBase, domain, "fullchain.pem")
}

// KeyPath returns the path to the private key for domain.
func (cm *CertManager) KeyPath(domain string) string {
	return filepath.Join(cm.certBase, domain, "privkey.pem")
}

// CertExists reports whether a certificate file exists for domain.
func (cm *CertManager) CertExists(domain string) bool {
	_, err := os.Stat(cm.CertPath(domain))
	return err == nil
}

// Obtain runs certbot to obtain a certificate for domain. If the certificate
// already exists, Obtain returns nil without running certbot.
func (cm *CertManager) Obtain(ctx context.Context, domain string) error {
	if cm.CertExists(domain) {
		return nil
	}

	cmd := exec.CommandContext(ctx, "certbot", "certonly",
		"--webroot",
		"-w", cm.Webroot,
		"--email", cm.Email,
		"--agree-tos",
		"--non-interactive",
		"-d", domain,
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("certbot for %s: %w", domain, err)
	}
	return nil
}

// ObtainAll obtains certificates for every domain in the slice. It stops and
// returns on the first error encountered.
func (cm *CertManager) ObtainAll(ctx context.Context, domains []string) error {
	for _, d := range domains {
		if err := cm.Obtain(ctx, d); err != nil {
			return err
		}
	}
	return nil
}

// CheckExpiry reads the certificate for domain and returns the number of full
// days remaining until it expires.
func (cm *CertManager) CheckExpiry(domain string) (daysRemaining int, err error) {
	certFile := cm.CertPath(domain)

	data, err := os.ReadFile(certFile)
	if err != nil {
		return 0, fmt.Errorf("reading cert for %s: %w", domain, err)
	}

	block, _ := pem.Decode(data)
	if block == nil {
		return 0, fmt.Errorf("no PEM block found in %s", certFile)
	}

	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return 0, fmt.Errorf("parsing cert for %s: %w", domain, err)
	}

	remaining := time.Until(cert.NotAfter).Hours() / 24
	return int(math.Floor(remaining)), nil
}
