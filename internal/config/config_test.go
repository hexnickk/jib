package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const validConfig = `
poll_interval: 5m
certbot_email: nick@example.com

github:
  providers:
    my-deploy-bot:
      type: app
      app_id: 123456
    landing-key:
      type: key

backup_destinations:
  primary:
    driver: r2
    bucket: my-backups
    retain: 7
    local_retain: 3

webhook:
  enabled: true

tunnel:
  provider: cloudflare

notifications:
  ops-telegram:
    driver: telegram
  dev-slack:
    driver: slack

apps:
  myapp:
    repo: org/repo
    branch: main
    compose: docker-compose.yml
    strategy: restart
    health:
      - path: /health
        port: 3000
    warmup: 10s
    pre_deploy:
      - service: migrations
    build_args:
      VITE_URL: https://example.com
    domains:
      - host: example.com
        port: 3000
      - host: api.example.com
        port: 3001
    nginx_include: infra/nginx/custom.conf
    backup:
      destination: primary
      schedule: "0 4 * * *"
      volumes: [db_data]
      hook: scripts/backup.sh
    secrets_env: true
    env_file: .env.prod
    services: [api, web]
    cron:
      - schedule: "0 9 * * *"
        service: api
        command: npm run digest
`

func writeTemp(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "config.yml")
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestLoadValidConfig(t *testing.T) {
	cfg, err := LoadConfig(writeTemp(t, validConfig))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.PollInterval != "5m" {
		t.Errorf("poll_interval = %q, want 5m", cfg.PollInterval)
	}
	if cfg.CertbotEmail != "nick@example.com" {
		t.Errorf("certbot_email = %q", cfg.CertbotEmail)
	}
	if cfg.GitHub == nil || len(cfg.GitHub.Providers) != 2 {
		t.Error("github.providers wrong")
	}
	if p, ok := cfg.LookupProvider("my-deploy-bot"); !ok || p.Type != "app" || p.AppID != 123456 {
		t.Error("provider my-deploy-bot wrong")
	}
	if p, ok := cfg.LookupProvider("landing-key"); !ok || p.Type != "key" {
		t.Error("provider landing-key wrong")
	}
	if cfg.Webhook.Port != 9090 {
		t.Errorf("webhook port = %d, want 9090 (default)", cfg.Webhook.Port)
	}
	if cfg.Tunnel.Provider != "cloudflare" {
		t.Errorf("tunnel provider = %q", cfg.Tunnel.Provider)
	}

	app, ok := cfg.Apps["myapp"]
	if !ok {
		t.Fatal("app 'myapp' not found")
	}
	if app.Repo != "org/repo" {
		t.Errorf("repo = %q", app.Repo)
	}
	if len(app.Compose) != 1 || app.Compose[0] != "docker-compose.yml" {
		t.Errorf("compose = %v", app.Compose)
	}
	if len(app.Domains) != 2 {
		t.Errorf("domains count = %d", len(app.Domains))
	}
	if app.Domains[0].Host != "example.com" || app.Domains[0].Port != 3000 {
		t.Errorf("domain[0] = %+v", app.Domains[0])
	}
	if len(app.Health) != 1 || app.Health[0].Path != "/health" || app.Health[0].Port != 3000 {
		t.Errorf("health = %+v", app.Health)
	}
	if app.Backup == nil || app.Backup.Schedule != "0 4 * * *" {
		t.Error("backup config wrong")
	}
	if len(app.Cron) != 1 || app.Cron[0].Service != "api" {
		t.Errorf("cron = %+v", app.Cron)
	}
	if app.EnvFile != ".env.prod" {
		t.Errorf("env_file = %q", app.EnvFile)
	}
}

func TestDefaults(t *testing.T) {
	yml := `
apps:
  simple:
    repo: org/repo
    domains:
      - host: example.com
        port: 80
`
	cfg, err := LoadConfig(writeTemp(t, yml))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	app := cfg.Apps["simple"]
	if app.Branch != "main" {
		t.Errorf("default branch = %q, want 'main'", app.Branch)
	}
	if app.Strategy != "restart" {
		t.Errorf("default strategy = %q, want 'restart'", app.Strategy)
	}
	if app.EnvFile != ".env" {
		t.Errorf("default env_file = %q, want '.env'", app.EnvFile)
	}
	if cfg.PollInterval != "5m" {
		t.Errorf("default poll_interval = %q, want '5m'", cfg.PollInterval)
	}
}

func TestStringOrSlice_String(t *testing.T) {
	yml := `
apps:
  a:
    repo: org/repo
    compose: docker-compose.yml
    domains:
      - host: example.com
        port: 80
`
	cfg, err := LoadConfig(writeTemp(t, yml))
	if err != nil {
		t.Fatal(err)
	}
	c := cfg.Apps["a"].Compose
	if len(c) != 1 || c[0] != "docker-compose.yml" {
		t.Errorf("compose from string = %v", c)
	}
}

func TestStringOrSlice_List(t *testing.T) {
	yml := `
apps:
  a:
    repo: org/repo
    compose:
      - docker-compose.yml
      - docker-compose.prod.yml
    domains:
      - host: example.com
        port: 80
`
	cfg, err := LoadConfig(writeTemp(t, yml))
	if err != nil {
		t.Fatal(err)
	}
	c := cfg.Apps["a"].Compose
	if len(c) != 2 || c[0] != "docker-compose.yml" || c[1] != "docker-compose.prod.yml" {
		t.Errorf("compose from list = %v", c)
	}
}

func TestValidation_BadAppName(t *testing.T) {
	yml := `
apps:
  My_App:
    repo: org/repo
    domains:
      - host: example.com
        port: 80
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for bad app name")
	}
	if !strings.Contains(err.Error(), "name must match") {
		t.Errorf("error = %v", err)
	}
}

func TestValidation_BadDomain(t *testing.T) {
	yml := `
apps:
  myapp:
    repo: org/repo
    domains:
      - host: INVALID..HOST
        port: 80
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for bad domain")
	}
	if !strings.Contains(err.Error(), "invalid hostname") {
		t.Errorf("error = %v", err)
	}
}

func TestValidation_BadPort(t *testing.T) {
	yml := `
apps:
  myapp:
    repo: org/repo
    domains:
      - host: example.com
        port: 99999
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for bad port")
	}
	if !strings.Contains(err.Error(), "invalid port 99999") {
		t.Errorf("error = %v", err)
	}
}

func TestValidation_BadStrategy(t *testing.T) {
	yml := `
apps:
  myapp:
    repo: org/repo
    strategy: canary
    domains:
      - host: example.com
        port: 80
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for bad strategy")
	}
	if !strings.Contains(err.Error(), "strategy must be") {
		t.Errorf("error = %v", err)
	}
}

func TestValidation_MissingRepo(t *testing.T) {
	yml := `
apps:
  myapp:
    domains:
      - host: example.com
        port: 80
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for missing repo")
	}
	if !strings.Contains(err.Error(), "repo is required") {
		t.Errorf("error = %v", err)
	}
}

func TestValidation_MissingDomains(t *testing.T) {
	yml := `
apps:
  myapp:
    repo: org/repo
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for missing domains")
	}
	if !strings.Contains(err.Error(), "at least one domain") {
		t.Errorf("error = %v", err)
	}
}

func TestValidation_HealthCheckPath(t *testing.T) {
	yml := `
apps:
  myapp:
    repo: org/repo
    health:
      - path: health
        port: 3000
    domains:
      - host: example.com
        port: 80
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for health path without /")
	}
	if !strings.Contains(err.Error(), "must start with '/'") {
		t.Errorf("error = %v", err)
	}
}

func TestValidation_BadPollInterval(t *testing.T) {
	yml := `
poll_interval: nope
apps:
  myapp:
    repo: org/repo
    domains:
      - host: example.com
        port: 80
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for bad poll_interval")
	}
	if !strings.Contains(err.Error(), "invalid duration") {
		t.Errorf("error = %v", err)
	}
}

func TestValidation_BadBackupDriver(t *testing.T) {
	yml := `
backup_destinations:
  main:
    driver: gcs
    bucket: b
apps:
  myapp:
    repo: org/repo
    domains:
      - host: example.com
        port: 80
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for bad backup driver")
	}
	if !strings.Contains(err.Error(), "driver must be") {
		t.Errorf("error = %v", err)
	}
}

func TestValidation_BadTunnelProvider(t *testing.T) {
	yml := `
tunnel:
  provider: wireguard
apps:
  myapp:
    repo: org/repo
    domains:
      - host: example.com
        port: 80
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for bad tunnel provider")
	}
	if !strings.Contains(err.Error(), "provider must be") {
		t.Errorf("error = %v", err)
	}
}

func TestValidation_BadCronSchedule(t *testing.T) {
	yml := `
apps:
  myapp:
    repo: org/repo
    domains:
      - host: example.com
        port: 80
    cron:
      - schedule: "* *"
        service: api
        command: run
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for bad cron schedule")
	}
	if !strings.Contains(err.Error(), "must have 5 fields") {
		t.Errorf("error = %v", err)
	}
}

func TestValidation_MultipleErrors(t *testing.T) {
	yml := `
poll_interval: bad
apps:
  My_App:
    strategy: canary
    domains: []
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected errors")
	}
	ve, ok := err.(*ValidationError)
	if !ok {
		t.Fatalf("expected *ValidationError, got %T", err)
	}
	if len(ve.Errors) < 3 {
		t.Errorf("expected at least 3 errors, got %d: %v", len(ve.Errors), ve.Errors)
	}
}

func TestValidation_BadWarmup(t *testing.T) {
	yml := `
apps:
  myapp:
    repo: org/repo
    warmup: ten seconds
    domains:
      - host: example.com
        port: 80
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for bad warmup")
	}
	if !strings.Contains(err.Error(), "warmup: invalid duration") {
		t.Errorf("error = %v", err)
	}
}

func TestValidation_BackupDestNotDefined(t *testing.T) {
	yml := `
apps:
  myapp:
    repo: org/repo
    domains:
      - host: example.com
        port: 80
    backup:
      destination: nonexistent
      schedule: "0 4 * * *"
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for undefined backup destination")
	}
	if !strings.Contains(err.Error(), "not defined in backup_destinations") {
		t.Errorf("error = %v", err)
	}
}

func TestValidation_CronMissingServiceCommand(t *testing.T) {
	yml := `
apps:
  myapp:
    repo: org/repo
    domains:
      - host: example.com
        port: 80
    cron:
      - schedule: "0 9 * * *"
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for cron missing service/command")
	}
	errStr := err.Error()
	if !strings.Contains(errStr, "service is required") {
		t.Errorf("expected service error, got: %v", errStr)
	}
	if !strings.Contains(errStr, "command is required") {
		t.Errorf("expected command error, got: %v", errStr)
	}
}

func TestValidation_NotifyUndefinedChannel(t *testing.T) {
	yml := `
notifications:
  ops:
    driver: telegram
apps:
  myapp:
    repo: org/repo
    domains:
      - host: example.com
        port: 80
    notify:
      - ops
      - nonexistent
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for undefined notify channel")
	}
	if !strings.Contains(err.Error(), "undefined channel") {
		t.Errorf("error = %v", err)
	}
}

func TestValidation_BadNotifyDriver(t *testing.T) {
	yml := `
notifications:
  test:
    driver: email
apps:
  myapp:
    repo: org/repo
    domains:
      - host: example.com
        port: 80
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for bad notify driver")
	}
	if !strings.Contains(err.Error(), "driver must be") {
		t.Errorf("error = %v", err)
	}
}

func TestDefaultConfigPath(t *testing.T) {
	if DefaultConfigPath() != "/opt/jib/config.yml" {
		t.Errorf("DefaultConfigPath() = %q", DefaultConfigPath())
	}
}

func TestDomainIsTunnelIngress(t *testing.T) {
	tests := []struct {
		ingress string
		want    bool
	}{
		{"", false},
		{"direct", false},
		{"cloudflare-tunnel", true},
		{"tailscale", true},
	}
	for _, tt := range tests {
		d := Domain{Host: "example.com", Port: 80, Ingress: tt.ingress}
		if got := d.IsTunnelIngress(); got != tt.want {
			t.Errorf("Domain{Ingress: %q}.IsTunnelIngress() = %v, want %v", tt.ingress, got, tt.want)
		}
	}
}

func TestMigrateV1AppIngress(t *testing.T) {
	yml := `
config_version: 1
apps:
  myapp:
    repo: org/repo
    ingress: cloudflare-tunnel
    domains:
      - host: example.com
        port: 80
      - host: api.example.com
        port: 3000
`
	cfg, err := LoadConfig(writeTemp(t, yml))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	app := cfg.Apps["myapp"]
	// App-level ingress should be cleared after migration
	if app.Ingress != "" {
		t.Errorf("app.Ingress = %q, want empty (migrated to domains)", app.Ingress)
	}
	// Both domains should have the ingress
	for i, d := range app.Domains {
		if d.Ingress != "cloudflare-tunnel" {
			t.Errorf("domain[%d].Ingress = %q, want cloudflare-tunnel", i, d.Ingress)
		}
	}
	if cfg.ConfigVersion != 2 {
		t.Errorf("config_version = %d, want 2", cfg.ConfigVersion)
	}
}

func TestPerDomainIngress(t *testing.T) {
	yml := `
config_version: 2
apps:
  myapp:
    repo: org/repo
    domains:
      - host: example.com
        port: 80
        ingress: cloudflare-tunnel
      - host: admin.example.com
        port: 80
        ingress: tailscale
      - host: staging.example.com
        port: 80
`
	cfg, err := LoadConfig(writeTemp(t, yml))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	app := cfg.Apps["myapp"]
	if app.Domains[0].Ingress != "cloudflare-tunnel" {
		t.Errorf("domain[0].Ingress = %q", app.Domains[0].Ingress)
	}
	if app.Domains[1].Ingress != "tailscale" {
		t.Errorf("domain[1].Ingress = %q", app.Domains[1].Ingress)
	}
	if app.Domains[2].Ingress != "" {
		t.Errorf("domain[2].Ingress = %q, want empty (direct)", app.Domains[2].Ingress)
	}
}

func TestValidation_BadDomainIngress(t *testing.T) {
	yml := `
config_version: 2
apps:
  myapp:
    repo: org/repo
    domains:
      - host: example.com
        port: 80
        ingress: wireguard
`
	_, err := LoadConfig(writeTemp(t, yml))
	if err == nil {
		t.Fatal("expected error for bad domain ingress")
	}
	if !strings.Contains(err.Error(), "ingress must be") {
		t.Errorf("error = %v", err)
	}
}
