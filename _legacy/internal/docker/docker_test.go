package docker

import (
	"testing"
)

func TestProjectName(t *testing.T) {
	c := &Compose{App: "myapp"}
	got := c.ProjectName()
	want := "jib-myapp"
	if got != want {
		t.Errorf("ProjectName() = %q, want %q", got, want)
	}
}

func TestProjectNamePrefix(t *testing.T) {
	tests := []struct {
		app  string
		want string
	}{
		{"myapp", "jib-myapp"},
		{"otherapp", "jib-otherapp"},
		{"a", "jib-a"},
	}
	for _, tt := range tests {
		c := &Compose{App: tt.app}
		if got := c.ProjectName(); got != tt.want {
			t.Errorf("ProjectName() for app %q = %q, want %q", tt.app, got, tt.want)
		}
	}
}

func TestBaseArgsSingleFile(t *testing.T) {
	c := &Compose{
		App:   "myapp",
		Dir:   "/srv/jib/repos/myapp",
		Files: []string{"docker-compose.yml"},
	}
	args := c.baseArgs()
	expected := []string{"compose", "-p", "jib-myapp", "-f", "docker-compose.yml"}
	if len(args) != len(expected) {
		t.Fatalf("baseArgs() returned %d args, want %d: %v", len(args), len(expected), args)
	}
	for i, arg := range args {
		if arg != expected[i] {
			t.Errorf("baseArgs()[%d] = %q, want %q", i, arg, expected[i])
		}
	}
}

func TestBaseArgsMultipleFiles(t *testing.T) {
	c := &Compose{
		App:   "myapp",
		Dir:   "/srv/jib/repos/myapp",
		Files: []string{"docker-compose.yml", "docker-compose.prod.yml"},
	}
	args := c.baseArgs()
	expected := []string{
		"compose", "-p", "jib-myapp",
		"-f", "docker-compose.yml",
		"-f", "docker-compose.prod.yml",
	}
	if len(args) != len(expected) {
		t.Fatalf("baseArgs() returned %d args, want %d: %v", len(args), len(expected), args)
	}
	for i, arg := range args {
		if arg != expected[i] {
			t.Errorf("baseArgs()[%d] = %q, want %q", i, arg, expected[i])
		}
	}
}

func TestBaseArgsNoFiles(t *testing.T) {
	c := &Compose{
		App: "myapp",
	}
	args := c.baseArgs()
	expected := []string{"compose", "-p", "jib-myapp"}
	if len(args) != len(expected) {
		t.Fatalf("baseArgs() returned %d args, want %d: %v", len(args), len(expected), args)
	}
	for i, arg := range args {
		if arg != expected[i] {
			t.Errorf("baseArgs()[%d] = %q, want %q", i, arg, expected[i])
		}
	}
}

func TestAllHealthyAllPass(t *testing.T) {
	results := []HealthResult{
		{Endpoint: "http://localhost:3000/health", OK: true, StatusCode: 200},
		{Endpoint: "http://localhost:3001/health", OK: true, StatusCode: 200},
	}
	if !AllHealthy(results) {
		t.Error("AllHealthy() = false, want true for all passing results")
	}
}

func TestAllHealthyOneFails(t *testing.T) {
	results := []HealthResult{
		{Endpoint: "http://localhost:3000/health", OK: true, StatusCode: 200},
		{Endpoint: "http://localhost:3001/health", OK: false, StatusCode: 500, Error: "unhealthy status: 500"},
	}
	if AllHealthy(results) {
		t.Error("AllHealthy() = true, want false when one result fails")
	}
}

func TestAllHealthyEmpty(t *testing.T) {
	if !AllHealthy(nil) {
		t.Error("AllHealthy(nil) = false, want true for empty results")
	}
	if !AllHealthy([]HealthResult{}) {
		t.Error("AllHealthy([]) = false, want true for empty results")
	}
}

func TestAllHealthyAllFail(t *testing.T) {
	results := []HealthResult{
		{Endpoint: "http://localhost:3000/health", OK: false, Error: "connection refused"},
		{Endpoint: "http://localhost:3001/health", OK: false, Error: "timeout"},
	}
	if AllHealthy(results) {
		t.Error("AllHealthy() = true, want false when all results fail")
	}
}

func TestEnvFileArgs(t *testing.T) {
	c := &Compose{App: "myapp", EnvFile: "/opt/jib/secrets/myapp/.env"}
	args := c.envFileArgs()
	if len(args) != 2 || args[0] != "--env-file" || args[1] != "/opt/jib/secrets/myapp/.env" {
		t.Errorf("envFileArgs() = %v, want [--env-file /opt/jib/secrets/myapp/.env]", args)
	}

	c2 := &Compose{App: "myapp"}
	args2 := c2.envFileArgs()
	if len(args2) != 0 {
		t.Errorf("envFileArgs() with no EnvFile = %v, want empty", args2)
	}
}
