package proxy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hexnickk/jib/internal/config"
)

func TestGenerateConfigSingleDomain(t *testing.T) {
	n := NewNginx("/opt/jib/nginx/", "/etc/nginx/conf.d/", 0)

	appCfg := config.App{
		Domains: []config.Domain{
			{Host: "example.com", Port: 3000},
		},
	}

	configs, err := n.GenerateConfig("myapp", appCfg)
	if err != nil {
		t.Fatalf("GenerateConfig failed: %v", err)
	}

	if len(configs) != 1 {
		t.Fatalf("expected 1 config, got %d", len(configs))
	}

	content, ok := configs["example.com.conf"]
	if !ok {
		t.Fatal("expected example.com.conf in output")
	}

	// Without an SSL cert on disk, the template produces HTTP-only config.
	checks := []string{
		"listen 80;",
		"server_name example.com;",
		"proxy_pass http://127.0.0.1:3000;",
		"location /.well-known/acme-challenge/",
		"root /var/www/certbot;",
	}
	for _, check := range checks {
		if !strings.Contains(content, check) {
			t.Errorf("config missing %q", check)
		}
	}

	// SSL blocks should NOT be present when no cert exists.
	sslAbsent := []string{
		"listen 443 ssl;",
		"ssl_certificate",
		"return 301 https://",
	}
	for _, check := range sslAbsent {
		if strings.Contains(content, check) {
			t.Errorf("config should not contain %q without SSL cert", check)
		}
	}

	// Webhook location should NOT be present when port is 0.
	if strings.Contains(content, "/_jib/webhook") {
		t.Error("config should not contain webhook location when port is 0")
	}
}

func TestGenerateConfigMultipleDomains(t *testing.T) {
	n := NewNginx("/opt/jib/nginx/", "/etc/nginx/conf.d/", 0)

	appCfg := config.App{
		Domains: []config.Domain{
			{Host: "example.com", Port: 3000},
			{Host: "api.example.com", Port: 3001},
		},
	}

	configs, err := n.GenerateConfig("myapp", appCfg)
	if err != nil {
		t.Fatalf("GenerateConfig failed: %v", err)
	}

	if len(configs) != 2 {
		t.Fatalf("expected 2 configs, got %d", len(configs))
	}

	if _, ok := configs["example.com.conf"]; !ok {
		t.Error("missing example.com.conf")
	}
	if _, ok := configs["api.example.com.conf"]; !ok {
		t.Error("missing api.example.com.conf")
	}

	// Each config should reference its own domain and port.
	if !strings.Contains(configs["example.com.conf"], "proxy_pass http://127.0.0.1:3000;") {
		t.Error("example.com.conf should proxy to port 3000")
	}
	if !strings.Contains(configs["api.example.com.conf"], "proxy_pass http://127.0.0.1:3001;") {
		t.Error("api.example.com.conf should proxy to port 3001")
	}
}

func TestGenerateConfigWebhookLocation(t *testing.T) {
	n := NewNginx("/opt/jib/nginx/", "/etc/nginx/conf.d/", 9090)

	appCfg := config.App{
		Domains: []config.Domain{
			{Host: "example.com", Port: 3000},
		},
	}

	configs, err := n.GenerateConfig("myapp", appCfg)
	if err != nil {
		t.Fatalf("GenerateConfig failed: %v", err)
	}

	content := configs["example.com.conf"]
	// Without an SSL cert, the webhook location (inside the SSL block) is not rendered.
	// Verify the HTTP-only proxy is present instead.
	if !strings.Contains(content, "proxy_pass http://127.0.0.1:3000;") {
		t.Error("config should contain proxy_pass for the app port")
	}
	if strings.Contains(content, "/_jib/webhook") {
		t.Error("webhook location should not appear without SSL")
	}
}

func TestGenerateConfigWithNginxInclude(t *testing.T) {
	n := NewNginx("/opt/jib/nginx/", "/etc/nginx/conf.d/", 0)

	appCfg := config.App{
		NginxInclude: "/opt/jib/repos/myapp/infra/nginx/custom.conf",
		Domains: []config.Domain{
			{Host: "example.com", Port: 3000},
		},
	}

	configs, err := n.GenerateConfig("myapp", appCfg)
	if err != nil {
		t.Fatalf("GenerateConfig failed: %v", err)
	}

	content := configs["example.com.conf"]
	// Without an SSL cert, the include directive (inside the SSL block) is not rendered.
	// Verify the HTTP-only proxy is generated correctly.
	if !strings.Contains(content, "proxy_pass http://127.0.0.1:3000;") {
		t.Errorf("config should contain proxy_pass, got:\n%s", content)
	}
	if strings.Contains(content, "include /opt/jib/repos/myapp/infra/nginx/custom.conf;") {
		t.Error("include directive should not appear without SSL")
	}
}

func TestGenerateConfigWithoutNginxInclude(t *testing.T) {
	n := NewNginx("/opt/jib/nginx/", "/etc/nginx/conf.d/", 0)

	appCfg := config.App{
		Domains: []config.Domain{
			{Host: "example.com", Port: 3000},
		},
	}

	configs, err := n.GenerateConfig("myapp", appCfg)
	if err != nil {
		t.Fatalf("GenerateConfig failed: %v", err)
	}

	content := configs["example.com.conf"]
	if strings.Contains(content, "include ") {
		t.Error("config should not contain include directive when NginxInclude is empty")
	}
}

func TestWriteConfigs(t *testing.T) {
	configDir := t.TempDir()
	symlinkDir := t.TempDir()

	n := NewNginx(configDir, symlinkDir, 0)

	configs := map[string]string{
		"example.com.conf": "# test config\nserver { listen 80; }",
	}

	if err := n.WriteConfigs(configs); err != nil {
		t.Fatalf("WriteConfigs failed: %v", err)
	}

	// Check config file exists with correct content.
	confPath := filepath.Join(configDir, "example.com.conf")
	data, err := os.ReadFile(confPath)
	if err != nil {
		t.Fatalf("config file not found: %v", err)
	}
	if string(data) != configs["example.com.conf"] {
		t.Errorf("config content mismatch: got %q", string(data))
	}

	// Check symlink exists and points to the right target.
	linkPath := filepath.Join(symlinkDir, "example.com.conf")
	target, err := os.Readlink(linkPath)
	if err != nil {
		t.Fatalf("symlink not found: %v", err)
	}
	if target != confPath {
		t.Errorf("symlink target mismatch: got %q, want %q", target, confPath)
	}
}

func TestRemoveConfigs(t *testing.T) {
	configDir := t.TempDir()
	symlinkDir := t.TempDir()

	n := NewNginx(configDir, symlinkDir, 0)

	// Create a config file and symlink first.
	confPath := filepath.Join(configDir, "example.com.conf")
	if err := os.WriteFile(confPath, []byte("# test"), 0o644); err != nil {
		t.Fatal(err)
	}
	linkPath := filepath.Join(symlinkDir, "example.com.conf")
	if err := os.Symlink(confPath, linkPath); err != nil {
		t.Fatal(err)
	}

	domains := []config.Domain{
		{Host: "example.com", Port: 3000},
	}

	if err := n.RemoveConfigs("myapp", domains); err != nil {
		t.Fatalf("RemoveConfigs failed: %v", err)
	}

	// Both files should be gone.
	if _, err := os.Stat(confPath); !os.IsNotExist(err) {
		t.Error("config file should have been removed")
	}
	if _, err := os.Lstat(linkPath); !os.IsNotExist(err) {
		t.Error("symlink should have been removed")
	}
}
