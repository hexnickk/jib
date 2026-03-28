package docker

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseComposeServicesWithLabels(t *testing.T) {
	dir := t.TempDir()
	compose := `
services:
  web:
    image: nginx
    ports:
      - "8080:80"
    labels:
      jib.domain: example.com
  api:
    image: node
    ports:
      - "3000:3000"
    labels:
      jib.domain: api.example.com
  db:
    image: postgres
`
	if err := os.WriteFile(filepath.Join(dir, "docker-compose.yml"), []byte(compose), 0o600); err != nil {
		t.Fatal(err)
	}

	svcs, err := ParseComposeServices(dir, nil)
	if err != nil {
		t.Fatal(err)
	}

	byName := make(map[string]ComposeService)
	for _, s := range svcs {
		byName[s.Name] = s
	}

	if byName["web"].Domain != "example.com" {
		t.Errorf("web domain = %q, want example.com", byName["web"].Domain)
	}
	if byName["api"].Domain != "api.example.com" {
		t.Errorf("api domain = %q, want api.example.com", byName["api"].Domain)
	}
	if byName["db"].Domain != "" {
		t.Errorf("db domain = %q, want empty", byName["db"].Domain)
	}
}

func TestParseComposeLabelsListFormat(t *testing.T) {
	dir := t.TempDir()
	compose := `
services:
  web:
    image: nginx
    ports:
      - "8080:80"
    labels:
      - "jib.domain=example.com"
      - "other.label=foo"
`
	if err := os.WriteFile(filepath.Join(dir, "docker-compose.yml"), []byte(compose), 0o600); err != nil {
		t.Fatal(err)
	}

	svcs, err := ParseComposeServices(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(svcs) != 1 {
		t.Fatalf("got %d services, want 1", len(svcs))
	}
	if svcs[0].Domain != "example.com" {
		t.Errorf("domain = %q, want example.com", svcs[0].Domain)
	}
}

func TestParseComposeServicesWithIngressLabel(t *testing.T) {
	dir := t.TempDir()
	compose := `
services:
  web:
    image: nginx
    ports:
      - "8080:80"
    labels:
      jib.domain: example.com
      jib.ingress: cloudflare-tunnel
  api:
    image: node
    ports:
      - "3000:3000"
    labels:
      jib.domain: api.example.com
`
	if err := os.WriteFile(filepath.Join(dir, "docker-compose.yml"), []byte(compose), 0o600); err != nil {
		t.Fatal(err)
	}

	svcs, err := ParseComposeServices(dir, nil)
	if err != nil {
		t.Fatal(err)
	}

	byName := make(map[string]ComposeService)
	for _, s := range svcs {
		byName[s.Name] = s
	}

	if byName["web"].Ingress != "cloudflare-tunnel" {
		t.Errorf("web ingress = %q, want cloudflare-tunnel", byName["web"].Ingress)
	}
	if byName["api"].Ingress != "" {
		t.Errorf("api ingress = %q, want empty", byName["api"].Ingress)
	}
}

func TestParseComposeLabelsOverride(t *testing.T) {
	dir := t.TempDir()
	base := `
services:
  web:
    image: nginx
    ports:
      - "8080:80"
    labels:
      jib.domain: old.example.com
`
	override := `
services:
  web:
    labels:
      jib.domain: new.example.com
`
	if err := os.WriteFile(filepath.Join(dir, "docker-compose.yml"), []byte(base), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "override.yml"), []byte(override), 0o600); err != nil {
		t.Fatal(err)
	}

	svcs, err := ParseComposeServices(dir, []string{"docker-compose.yml", "override.yml"})
	if err != nil {
		t.Fatal(err)
	}
	if len(svcs) != 1 {
		t.Fatalf("got %d services, want 1", len(svcs))
	}
	if svcs[0].Domain != "new.example.com" {
		t.Errorf("domain = %q, want new.example.com (override should win)", svcs[0].Domain)
	}
	if svcs[0].HostPort != 8080 {
		t.Errorf("port = %d, want 8080 (base port should be preserved)", svcs[0].HostPort)
	}
}

func TestServiceByName(t *testing.T) {
	svcs := []ComposeService{
		{Name: "web", HostPort: 8080},
		{Name: "api", HostPort: 3000},
	}

	svc, ok := ServiceByName(svcs, "api")
	if !ok {
		t.Fatal("expected to find api")
	}
	if svc.HostPort != 3000 {
		t.Errorf("api port = %d, want 3000", svc.HostPort)
	}

	_, ok = ServiceByName(svcs, "db")
	if ok {
		t.Error("expected db to not be found")
	}
}

func TestServicesWithDomainLabels(t *testing.T) {
	svcs := []ComposeService{
		{Name: "web", HostPort: 8080, Domain: "example.com"},
		{Name: "api", HostPort: 3000},
		{Name: "admin", HostPort: 4000, Domain: "admin.example.com"},
	}

	labeled := ServicesWithDomainLabels(svcs)
	if len(labeled) != 2 {
		t.Fatalf("got %d labeled, want 2", len(labeled))
	}
	names := map[string]bool{}
	for _, s := range labeled {
		names[s.Name] = true
	}
	if !names["web"] || !names["admin"] {
		t.Errorf("expected web and admin, got %v", names)
	}
}
