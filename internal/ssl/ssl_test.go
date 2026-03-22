package ssl

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCertPath(t *testing.T) {
	cm := NewCertManager("test@example.com", "/var/www/certbot")
	want := "/etc/letsencrypt/live/example.com/fullchain.pem"
	if got := cm.CertPath("example.com"); got != want {
		t.Errorf("CertPath = %q, want %q", got, want)
	}
}

func TestKeyPath(t *testing.T) {
	cm := NewCertManager("test@example.com", "/var/www/certbot")
	want := "/etc/letsencrypt/live/example.com/privkey.pem"
	if got := cm.KeyPath("example.com"); got != want {
		t.Errorf("KeyPath = %q, want %q", got, want)
	}
}

func TestCertExistsFalse(t *testing.T) {
	cm := NewCertManager("test@example.com", "/var/www/certbot")
	if cm.CertExists("nonexistent.invalid.domain.test") {
		t.Error("CertExists returned true for non-existent domain")
	}
}

func TestCertExistsTrue(t *testing.T) {
	cm := newTestCertManager(t)
	domain := "exists.local"
	writeSelfSignedCert(t, cm.certBase, domain, 30*24*time.Hour)

	if !cm.CertExists(domain) {
		t.Error("CertExists returned false for existing domain cert")
	}
}

func TestCheckExpiry(t *testing.T) {
	cm := newTestCertManager(t)
	domain := "expiry.local"
	validity := 30 * 24 * time.Hour
	writeSelfSignedCert(t, cm.certBase, domain, validity)

	days, err := cm.CheckExpiry(domain)
	if err != nil {
		t.Fatalf("CheckExpiry: %v", err)
	}

	// The cert was just created with 30-day validity, so days should be 29 or 30.
	if days < 29 || days > 30 {
		t.Errorf("expected ~30 days remaining, got %d", days)
	}
}

func TestCheckExpiryShort(t *testing.T) {
	cm := newTestCertManager(t)
	domain := "short.local"
	writeSelfSignedCert(t, cm.certBase, domain, 5*24*time.Hour)

	days, err := cm.CheckExpiry(domain)
	if err != nil {
		t.Fatalf("CheckExpiry: %v", err)
	}

	if days < 4 || days > 5 {
		t.Errorf("expected ~5 days remaining, got %d", days)
	}
}

func TestCheckExpiryMissing(t *testing.T) {
	cm := newTestCertManager(t)
	_, err := cm.CheckExpiry("missing.local")
	if err == nil {
		t.Error("expected error for missing domain cert")
	}
}

// --- helpers ---

// newTestCertManager returns a CertManager whose certBase points at a
// temporary directory, so tests never touch /etc/letsencrypt.
func newTestCertManager(t *testing.T) *CertManager {
	t.Helper()
	cm := NewCertManager("test@example.com", "/var/www/certbot")
	cm.certBase = t.TempDir()
	return cm
}

// writeSelfSignedCert generates a self-signed certificate valid for the given
// duration and writes it as PEM into <base>/<domain>/fullchain.pem.
func writeSelfSignedCert(t *testing.T, base, domain string, validity time.Duration) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	template := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: domain},
		NotBefore:    now,
		NotAfter:     now.Add(validity),
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}

	dir := filepath.Join(base, domain)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	f, err := os.Create(filepath.Join(dir, "fullchain.pem"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	if err := pem.Encode(f, &pem.Block{Type: "CERTIFICATE", Bytes: derBytes}); err != nil {
		t.Fatal(err)
	}
}
