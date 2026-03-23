// Package network provides domain reachability checks for jib.
package network

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

// DomainCheck holds the result of checking a domain's reachability.
type DomainCheck struct {
	Domain      string
	IPs         []string
	Reachable   bool
	Transport   string // "direct", "cloudflare", "tailscale", "unknown"
	Warning     string // Non-empty if there's a problem
	Error       string // Non-empty if check itself failed
}

// cloudflareRanges is a subset of Cloudflare IP prefixes for detection.
var cloudflareRanges = []string{
	"173.245.", "103.21.", "103.22.", "103.31.",
	"104.16.", "104.17.", "104.18.", "104.19.", "104.20.",
	"104.21.", "104.22.", "104.23.", "104.24.", "104.25.",
	"108.162.", "131.0.", "141.101.", "162.158.",
	"172.64.", "172.65.", "172.66.", "172.67.", "172.68.",
	"188.114.", "190.93.", "197.234.", "198.41.",
}

// CheckDomain performs DNS resolution and classifies the result.
func CheckDomain(domain string) *DomainCheck {
	result := &DomainCheck{Domain: domain}

	ips, err := net.LookupHost(domain)
	if err != nil {
		if dnsErr, ok := err.(*net.DNSError); ok && dnsErr.IsNotFound {
			result.Warning = "domain does not exist in DNS (NXDOMAIN) — create an A record first"
		} else {
			result.Warning = fmt.Sprintf("DNS lookup failed: %v", err)
		}
		return result
	}

	result.IPs = ips

	// Classify based on IP
	serverIP := getPublicIP()

	for _, ip := range ips {
		if ip == serverIP {
			result.Transport = "direct"
			return result
		}
		if strings.HasPrefix(ip, "100.") {
			result.Transport = "tailscale"
			return result
		}
		for _, prefix := range cloudflareRanges {
			if strings.HasPrefix(ip, prefix) {
				result.Transport = "cloudflare"
				return result
			}
		}
	}

	// IP doesn't match this server, not Cloudflare, not Tailscale
	result.Transport = "unknown"
	result.Warning = fmt.Sprintf("domain resolves to %s which is not this server (%s)", ips[0], serverIP)
	return result
}

// ProbeReachability starts a temporary HTTP handler on nginx and verifies
// the domain routes to this server. Requires nginx to be running.
// This is an active check — it confirms end-to-end reachability regardless
// of DNS provider, CDN, or tunnel.
func ProbeReachability(ctx context.Context, domain string) (bool, error) {
	// Generate a random token
	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		return false, fmt.Errorf("generating token: %w", err)
	}
	token := hex.EncodeToString(tokenBytes)

	// Write a temporary nginx snippet that serves the token
	snippetPath := "/etc/nginx/conf.d/_jib_verify.conf"
	snippet := fmt.Sprintf(`server {
    listen 80;
    server_name %s;
    location = /.well-known/jib-verify {
        return 200 '%s';
        add_header Content-Type text/plain;
    }
}
`, domain, token)

	// Write, reload, probe, cleanup
	if err := writeAndReload(snippetPath, snippet); err != nil {
		return false, fmt.Errorf("setting up probe: %w", err)
	}
	defer cleanupProbe(snippetPath)

	// Small delay for nginx to reload
	time.Sleep(500 * time.Millisecond)

	// Try to reach the domain
	url := fmt.Sprintf("http://%s/.well-known/jib-verify", domain)
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return false, nil // Not reachable, but not an error in the check itself
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, nil
	}

	return strings.TrimSpace(string(body)) == token, nil
}

func writeAndReload(path, content string) error {
	cmd := exec.Command("bash", "-c", fmt.Sprintf("echo '%s' > %s && nginx -s reload 2>/dev/null", content, path))
	return cmd.Run()
}

func cleanupProbe(path string) {
	exec.Command("bash", "-c", fmt.Sprintf("rm -f %s && nginx -s reload 2>/dev/null", path)).Run()
}

// getPublicIP returns this server's public IP address.
func getPublicIP() string {
	client := &http.Client{Timeout: 5 * time.Second}
	for _, url := range []string{
		"https://ifconfig.me",
		"https://api.ipify.org",
		"https://icanhazip.com",
	} {
		resp, err := client.Get(url)
		if err != nil {
			continue
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			continue
		}
		ip := strings.TrimSpace(string(body))
		if net.ParseIP(ip) != nil {
			return ip
		}
	}
	return ""
}

// HasTailscale checks if Tailscale is active on this machine.
func HasTailscale() bool {
	cmd := exec.Command("tailscale", "status")
	return cmd.Run() == nil
}

// HasCloudflareTunnel checks if cloudflared is running.
func HasCloudflareTunnel() bool {
	cmd := exec.Command("pgrep", "-x", "cloudflared")
	return cmd.Run() == nil
}
