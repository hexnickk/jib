// Package github provides helpers for GitHub authentication providers.
package github

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/git"
)

const (
	// ProviderTypeKey is an SSH deploy key provider.
	ProviderTypeKey = "key"
	// ProviderTypeApp is a GitHub App provider.
	ProviderTypeApp = "app"
)

// KeyPath returns the SSH private key path for a deploy-key provider.
func KeyPath(root, providerName string) string {
	return filepath.Join(root, "deploy-keys", providerName)
}

// AppPEMPath returns the PEM file path for a GitHub App provider.
func AppPEMPath(providerName string) string {
	return config.CredsPath("github-app", providerName+".pem")
}

// GenerateDeployKey generates an ed25519 SSH keypair and returns the public key.
func GenerateDeployKey(root, providerName string) (string, error) {
	keyDir := filepath.Join(root, "deploy-keys")
	if err := os.MkdirAll(keyDir, 0o700); err != nil {
		return "", err
	}

	keyPath := KeyPath(root, providerName)

	keygen := exec.Command("ssh-keygen", "-t", "ed25519", "-f", keyPath, "-N", "", "-C", "jib-deploy-"+providerName) //nolint:gosec // args from trusted config
	keygen.Stdout = os.Stdout
	keygen.Stderr = os.Stderr
	if err := keygen.Run(); err != nil {
		return "", fmt.Errorf("ssh-keygen: %w", err)
	}
	_ = os.Chmod(keyPath, 0o600)

	pubKey, err := os.ReadFile(keyPath + ".pub") //nolint:gosec // path constructed from trusted config
	if err != nil {
		return "", fmt.Errorf("reading public key: %w", err)
	}

	return string(pubKey), nil
}

// SSHCloneURL returns the SSH clone URL for a GitHub repo.
func SSHCloneURL(repo string) string {
	return fmt.Sprintf("git@github.com:%s.git", repo)
}

// HTTPSCloneURL returns an HTTPS clone URL with an embedded access token.
func HTTPSCloneURL(repo, token string) string {
	return fmt.Sprintf("https://x-access-token:%s@github.com/%s.git", token, repo)
}

// ProviderNameAvailable checks that a provider name is valid and not already taken.
func ProviderNameAvailable(cfg *config.Config, name string) error {
	if _, ok := cfg.LookupProvider(name); ok {
		return fmt.Errorf("provider %q already exists", name)
	}
	return nil
}

// GenerateInstallationToken generates a short-lived GitHub App installation access token.
func GenerateInstallationToken(ctx context.Context, providerName string, appID int64, repo string) (string, error) {
	pemPath := AppPEMPath(providerName)
	pemData, err := os.ReadFile(pemPath) //nolint:gosec // path constructed from trusted config
	if err != nil {
		return "", fmt.Errorf("reading GitHub App PEM: %w", err)
	}

	jwt, err := createJWT(pemData, appID)
	if err != nil {
		return "", fmt.Errorf("creating JWT: %w", err)
	}

	// Extract org from repo (org/name)
	org := repo
	if i := strings.IndexByte(repo, '/'); i >= 0 {
		org = repo[:i]
	}

	installationID, err := findInstallation(ctx, jwt, org)
	if err != nil {
		return "", err
	}

	token, err := createAccessToken(ctx, jwt, installationID)
	if err != nil {
		return "", err
	}

	return token, nil
}

// SetRemoteToken updates the origin remote URL to include an access token for HTTPS fetches.
func SetRemoteToken(ctx context.Context, repoDir, repo, token string) error {
	return git.SetRemoteURL(ctx, repoDir, HTTPSCloneURL(repo, token))
}

func createJWT(pemData []byte, appID int64) (string, error) {
	block, _ := pem.Decode(pemData)
	if block == nil {
		return "", fmt.Errorf("failed to decode PEM block")
	}

	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		parsed, err2 := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err2 != nil {
			return "", fmt.Errorf("parsing private key: %w (also tried PKCS8: %w)", err, err2)
		}
		var ok bool
		key, ok = parsed.(*rsa.PrivateKey)
		if !ok {
			return "", fmt.Errorf("private key is not RSA")
		}
	}

	now := time.Now()
	header := base64url([]byte(`{"alg":"RS256","typ":"JWT"}`))
	payload := base64url([]byte(fmt.Sprintf(
		`{"iss":"%d","iat":%d,"exp":%d}`,
		appID, now.Unix()-60, now.Add(10*time.Minute).Unix(),
	)))

	signingInput := header + "." + payload

	h := crypto.SHA256.New()
	h.Write([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, h.Sum(nil))
	if err != nil {
		return "", fmt.Errorf("signing JWT: %w", err)
	}

	return signingInput + "." + base64url(sig), nil
}

func base64url(data []byte) string {
	return base64.RawURLEncoding.EncodeToString(data)
}

func findInstallation(ctx context.Context, jwt, org string) (int64, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/app/installations", nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("listing installations: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("listing installations: HTTP %d: %s", resp.StatusCode, body)
	}

	var installations []struct {
		ID      int64 `json:"id"`
		Account struct {
			Login string `json:"login"`
		} `json:"account"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&installations); err != nil {
		return 0, fmt.Errorf("decoding installations: %w", err)
	}

	for _, inst := range installations {
		if strings.EqualFold(inst.Account.Login, org) {
			return inst.ID, nil
		}
	}

	return 0, fmt.Errorf("no installation found for org %q", org)
}

func createAccessToken(ctx context.Context, jwt string, installationID int64) (string, error) {
	url := fmt.Sprintf("https://api.github.com/app/installations/%d/access_tokens", installationID)
	req, err := http.NewRequestWithContext(ctx, "POST", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("creating access token: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != 201 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("creating access token: HTTP %d: %s", resp.StatusCode, body)
	}

	var result struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decoding access token: %w", err)
	}

	return result.Token, nil
}
