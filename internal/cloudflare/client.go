// Package cloudflare provides an API client for managing Cloudflare Tunnels and DNS records.
package cloudflare

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Client communicates with the Cloudflare API.
type Client struct {
	Token   string
	BaseURL string // defaults to "https://api.cloudflare.com/client/v4"
	client  *http.Client
}

// NewClient creates a Cloudflare API client with the given bearer token.
func NewClient(token string) *Client {
	return &Client{
		Token:   token,
		BaseURL: "https://api.cloudflare.com/client/v4",
		client:  &http.Client{},
	}
}

// Tunnel represents a Cloudflare Tunnel.
type Tunnel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// DNSRecord represents a Cloudflare DNS record.
type DNSRecord struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Name    string `json:"name"`
	Content string `json:"content"`
	Proxied bool   `json:"proxied"`
}

// IngressRule represents one entry in a tunnel's ingress configuration.
type IngressRule struct {
	Hostname string `json:"hostname,omitempty"`
	Service  string `json:"service"`
}

// apiResponse is the Cloudflare API v4 response envelope.
type apiResponse struct {
	Success bool            `json:"success"`
	Errors  []apiError      `json:"errors"`
	Result  json.RawMessage `json:"result"`
}

type apiError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// VerifyToken validates the API token and returns the first account ID.
func (c *Client) VerifyToken(ctx context.Context) (string, error) {
	var verify struct {
		Status string `json:"status"`
	}
	if err := c.doJSON(ctx, "GET", "/user/tokens/verify", nil, &verify); err != nil {
		return "", fmt.Errorf("verifying token: %w", err)
	}
	if verify.Status != "active" {
		return "", fmt.Errorf("token status is %q, expected 'active'", verify.Status)
	}

	var accounts []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := c.doJSON(ctx, "GET", "/accounts?per_page=1", nil, &accounts); err != nil {
		return "", fmt.Errorf("listing accounts: %w", err)
	}
	if len(accounts) == 0 {
		return "", fmt.Errorf("no accounts found for this token")
	}
	return accounts[0].ID, nil
}

// CreateTunnel creates a new Cloudflare Tunnel.
func (c *Client) CreateTunnel(ctx context.Context, accountID, name, tunnelSecret string) (*Tunnel, error) {
	body := map[string]interface{}{
		"name":          name,
		"tunnel_secret": tunnelSecret,
		"config_src":    "cloudflare",
	}
	var tunnel Tunnel
	if err := c.doJSON(ctx, "POST", fmt.Sprintf("/accounts/%s/cfd_tunnel", accountID), body, &tunnel); err != nil {
		return nil, fmt.Errorf("creating tunnel: %w", err)
	}
	return &tunnel, nil
}

// GetTunnelToken retrieves the connector token for a tunnel.
func (c *Client) GetTunnelToken(ctx context.Context, accountID, tunnelID string) (string, error) {
	var token string
	if err := c.doJSON(ctx, "GET", fmt.Sprintf("/accounts/%s/cfd_tunnel/%s/token", accountID, tunnelID), nil, &token); err != nil {
		return "", fmt.Errorf("getting tunnel token: %w", err)
	}
	return token, nil
}

// GetTunnelIngress retrieves the current ingress rules for a tunnel.
func (c *Client) GetTunnelIngress(ctx context.Context, accountID, tunnelID string) ([]IngressRule, error) {
	// CF API result shape: {"config": {"ingress": [...]}}
	var cfg struct {
		Config struct {
			Ingress []IngressRule `json:"ingress"`
		} `json:"config"`
	}
	if err := c.doJSON(ctx, "GET", fmt.Sprintf("/accounts/%s/cfd_tunnel/%s/configurations", accountID, tunnelID), nil, &cfg); err != nil {
		return nil, fmt.Errorf("getting tunnel config: %w", err)
	}
	return cfg.Config.Ingress, nil
}

// PutTunnelIngress replaces the tunnel's ingress rules.
func (c *Client) PutTunnelIngress(ctx context.Context, accountID, tunnelID string, rules []IngressRule) error {
	body := map[string]interface{}{
		"config": map[string]interface{}{
			"ingress": rules,
		},
	}
	if err := c.doJSON(ctx, "PUT", fmt.Sprintf("/accounts/%s/cfd_tunnel/%s/configurations", accountID, tunnelID), body, nil); err != nil {
		return fmt.Errorf("updating tunnel config: %w", err)
	}
	return nil
}

// FindZoneID looks up the zone ID for a domain.
func (c *Client) FindZoneID(ctx context.Context, domain string) (string, error) {
	// Extract the base domain (last two labels) for zone lookup.
	base := baseDomain(domain)

	var zones []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := c.doJSON(ctx, "GET", fmt.Sprintf("/zones?name=%s&per_page=1", base), nil, &zones); err != nil {
		return "", fmt.Errorf("looking up zone for %s: %w", domain, err)
	}
	if len(zones) == 0 {
		return "", fmt.Errorf("zone not found for %s (looked up %s)", domain, base)
	}
	return zones[0].ID, nil
}

// CreateDNSRecord creates a DNS record. Returns the record if it already exists.
func (c *Client) CreateDNSRecord(ctx context.Context, zoneID string, record DNSRecord) (*DNSRecord, error) {
	body := map[string]interface{}{
		"type":    record.Type,
		"name":    record.Name,
		"content": record.Content,
		"proxied": record.Proxied,
	}
	var result DNSRecord
	if err := c.doJSON(ctx, "POST", fmt.Sprintf("/zones/%s/dns_records", zoneID), body, &result); err != nil {
		// Check for "record already exists" (code 81058)
		if strings.Contains(err.Error(), "81058") || strings.Contains(err.Error(), "already exists") {
			return &record, nil
		}
		return nil, fmt.Errorf("creating DNS record %s: %w", record.Name, err)
	}
	return &result, nil
}

// ListDNSRecords lists DNS records matching the given name.
func (c *Client) ListDNSRecords(ctx context.Context, zoneID, name string) ([]DNSRecord, error) {
	var records []DNSRecord
	if err := c.doJSON(ctx, "GET", fmt.Sprintf("/zones/%s/dns_records?name=%s", zoneID, name), nil, &records); err != nil {
		return nil, fmt.Errorf("listing DNS records for %s: %w", name, err)
	}
	return records, nil
}

// DeleteDNSRecord deletes a DNS record.
func (c *Client) DeleteDNSRecord(ctx context.Context, zoneID, recordID string) error {
	if err := c.doJSON(ctx, "DELETE", fmt.Sprintf("/zones/%s/dns_records/%s", zoneID, recordID), nil, nil); err != nil {
		return fmt.Errorf("deleting DNS record: %w", err)
	}
	return nil
}

// AddTunnelRoutes adds ingress rules and DNS CNAMEs for the given domains.
func (c *Client) AddTunnelRoutes(ctx context.Context, accountID, tunnelID string, domains []string) error {
	tunnelCNAME := tunnelID + ".cfargotunnel.com"

	// Add DNS records
	for _, domain := range domains {
		zoneID, err := c.FindZoneID(ctx, domain)
		if err != nil {
			fmt.Printf("  warning: %v (add DNS records for %s manually)\n", err, domain)
			continue
		}

		// Create CNAME for the domain
		rec := DNSRecord{Type: "CNAME", Name: domain, Content: tunnelCNAME, Proxied: true}
		if _, err := c.CreateDNSRecord(ctx, zoneID, rec); err != nil {
			fmt.Printf("  warning: DNS record for %s: %v\n", domain, err)
		} else {
			fmt.Printf("  dns: %s → %s\n", domain, tunnelCNAME)
		}

		// Create wildcard CNAME
		wildcard := "*." + domain
		wRec := DNSRecord{Type: "CNAME", Name: wildcard, Content: tunnelCNAME, Proxied: true}
		if _, err := c.CreateDNSRecord(ctx, zoneID, wRec); err != nil {
			fmt.Printf("  warning: DNS record for %s: %v\n", wildcard, err)
		} else {
			fmt.Printf("  dns: %s → %s\n", wildcard, tunnelCNAME)
		}
	}

	// Update tunnel ingress rules
	existing, err := c.GetTunnelIngress(ctx, accountID, tunnelID)
	if err != nil {
		return err
	}

	// Build new rules: existing (minus catch-all and duplicates) + new domains + catch-all
	newHostnames := make(map[string]bool)
	for _, domain := range domains {
		newHostnames[domain] = true
		newHostnames["*."+domain] = true
	}

	var rules []IngressRule
	for _, r := range existing {
		if r.Hostname != "" && !newHostnames[r.Hostname] {
			rules = append(rules, r)
		}
	}
	for _, domain := range domains {
		rules = append(rules,
			IngressRule{Hostname: domain, Service: "http://localhost:80"},
			IngressRule{Hostname: "*." + domain, Service: "http://localhost:80"},
		)
	}
	// Catch-all must be last
	rules = append(rules, IngressRule{Service: "http_status:404"})

	return c.PutTunnelIngress(ctx, accountID, tunnelID, rules)
}

// RemoveTunnelRoutes removes ingress rules and DNS CNAMEs for the given domains.
func (c *Client) RemoveTunnelRoutes(ctx context.Context, accountID, tunnelID string, domains []string) error {
	// Remove DNS records
	for _, domain := range domains {
		zoneID, err := c.FindZoneID(ctx, domain)
		if err != nil {
			continue
		}
		for _, name := range []string{domain, "*." + domain} {
			records, err := c.ListDNSRecords(ctx, zoneID, name)
			if err != nil {
				continue
			}
			for _, r := range records {
				_ = c.DeleteDNSRecord(ctx, zoneID, r.ID)
				fmt.Printf("  dns: removed %s\n", name)
			}
		}
	}

	// Remove tunnel ingress rules
	existing, err := c.GetTunnelIngress(ctx, accountID, tunnelID)
	if err != nil {
		return err
	}

	toRemove := make(map[string]bool)
	for _, domain := range domains {
		toRemove[domain] = true
		toRemove["*."+domain] = true
	}

	var rules []IngressRule
	for _, r := range existing {
		if r.Hostname != "" && !toRemove[r.Hostname] {
			rules = append(rules, r)
		}
	}
	rules = append(rules, IngressRule{Service: "http_status:404"})

	return c.PutTunnelIngress(ctx, accountID, tunnelID, rules)
}

// doJSON makes an API request and decodes the result.
func (c *Client) doJSON(ctx context.Context, method, path string, body interface{}, result interface{}) error {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, bodyReader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("reading response: %w", err)
	}

	var apiResp apiResponse
	if err := json.Unmarshal(respBody, &apiResp); err != nil {
		// Some endpoints (like tunnel token) return raw values
		if result != nil {
			return json.Unmarshal(respBody, result)
		}
		return fmt.Errorf("decoding response: %w", err)
	}

	if !apiResp.Success {
		if len(apiResp.Errors) > 0 {
			msgs := make([]string, len(apiResp.Errors))
			for i, e := range apiResp.Errors {
				msgs[i] = fmt.Sprintf("[%d] %s", e.Code, e.Message)
			}
			return fmt.Errorf("%s", strings.Join(msgs, "; "))
		}
		return fmt.Errorf("API error: HTTP %d", resp.StatusCode)
	}

	if result != nil && apiResp.Result != nil {
		return json.Unmarshal(apiResp.Result, result)
	}
	return nil
}

// baseDomain extracts the base domain (last two labels) from a hostname.
// e.g. "api.example.com" → "example.com", "example.com" → "example.com"
func baseDomain(domain string) string {
	parts := strings.Split(domain, ".")
	if len(parts) <= 2 {
		return domain
	}
	return strings.Join(parts[len(parts)-2:], ".")
}
