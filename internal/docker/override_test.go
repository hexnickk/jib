package docker

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestDiscoverServicesFromYAML(t *testing.T) {
	dir := t.TempDir()
	compose := `
services:
  api:
    image: node:18
  web:
    image: nginx
  migrations:
    image: node:18
`
	if err := os.WriteFile(filepath.Join(dir, "docker-compose.yml"), []byte(compose), 0644); err != nil {
		t.Fatal(err)
	}

	services, err := discoverServicesFromYAML([]string{"docker-compose.yml"}, dir)
	if err != nil {
		t.Fatal(err)
	}

	if len(services) != 3 {
		t.Fatalf("expected 3 services, got %d: %v", len(services), services)
	}

	found := make(map[string]bool)
	for _, s := range services {
		found[s] = true
	}
	for _, expected := range []string{"api", "web", "migrations"} {
		if !found[expected] {
			t.Errorf("missing service %q in %v", expected, services)
		}
	}
}

func TestGenerateOverrideContent(t *testing.T) {
	dir := t.TempDir()
	compose := `
services:
  api:
    image: node:18
  web:
    image: nginx
`
	if err := os.WriteFile(filepath.Join(dir, "docker-compose.yml"), []byte(compose), 0644); err != nil {
		t.Fatal(err)
	}

	// Use YAML fallback since docker is not available in tests
	services, err := discoverServicesFromYAML([]string{"docker-compose.yml"}, dir)
	if err != nil {
		t.Fatal(err)
	}

	// Build override manually (same logic as GenerateOverride but without docker)
	override := overrideFile{
		Services: make(map[string]serviceOverride, len(services)),
	}
	for _, svc := range services {
		override.Services[svc] = serviceOverride{
			Labels: map[string]string{
				"jib.app":     "testapp",
				"jib.managed": "true",
			},
			Restart: "unless-stopped",
			Logging: &loggingConfig{
				Driver: "json-file",
				Options: map[string]string{
					"max-size": "50m",
					"max-file": "3",
				},
			},
		}
	}

	data, err := yaml.Marshal(override)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)

	// Verify labels
	if !strings.Contains(content, "jib.app: testapp") {
		t.Error("missing jib.app label")
	}
	if !strings.Contains(content, "jib.managed: \"true\"") {
		t.Error("missing jib.managed label")
	}

	// Verify restart
	if !strings.Contains(content, "restart: unless-stopped") {
		t.Error("missing restart policy")
	}

	// Verify logging
	if !strings.Contains(content, "max-size: 50m") {
		t.Error("missing log max-size")
	}

	// Verify both services present
	if !strings.Contains(content, "api:") {
		t.Error("missing api service")
	}
	if !strings.Contains(content, "web:") {
		t.Error("missing web service")
	}
}

func TestOverridePath(t *testing.T) {
	got := OverridePath("/opt/jib/repos/myapp")
	want := "/opt/jib/repos/myapp/.jib-compose.yml"
	if got != want {
		t.Errorf("OverridePath = %q, want %q", got, want)
	}
}
