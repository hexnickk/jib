package platform

import (
	"testing"
)

func TestParseVersion(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Docker version 24.0.7, build afdd53b", "24.0.7"},
		{"nginx version: nginx/1.24.0", "1.24.0"},
		{"certbot 2.7.4", "2.7.4"},
		{"rclone v1.65.0", "1.65.0"},
		{"git version 2.39.0", "2.39.0"},
		{"docker compose version v2.24.0", "2.24.0"},
		{"Docker version 27.1.2, build something", "27.1.2"},
		{"", ""},
		{"no version here", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ParseVersion(tt.input)
			if got != tt.expected {
				t.Errorf("ParseVersion(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		a, b     string
		expected int
	}{
		{"24.0.7", "24.0", 0},
		{"24.0", "24.0", 0},
		{"24.1", "24.0", 1},
		{"23.9", "24.0", -1},
		{"2.20", "2.20", 0},
		{"2.24", "2.20", 1},
		{"2.19", "2.20", -1},
		{"1.24.0", "1.18", 1},
		{"1.18.0", "1.18", 0},
		{"1.17.9", "1.18", -1},
		{"2.7.4", "2.0", 1},
		{"1.65.0", "1.50", 1},
		{"2.39.0", "2.25", 1},
		{"1.0", "2.0", -1},
		{"3.0", "2.0", 1},
	}

	for _, tt := range tests {
		t.Run(tt.a+"_vs_"+tt.b, func(t *testing.T) {
			got := CompareVersions(tt.a, tt.b)
			if got != tt.expected {
				t.Errorf("CompareVersions(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.expected)
			}
		})
	}
}

func TestDependenciesListComplete(t *testing.T) {
	expected := map[string]bool{
		"Docker":         false,
		"Docker Compose": false,
		"Nginx":          false,
		"Certbot":        false,
		"Rclone":         false,
		"Git":            false,
	}

	if len(Dependencies) != 6 {
		t.Errorf("expected 6 dependencies, got %d", len(Dependencies))
	}

	for _, dep := range Dependencies {
		if _, ok := expected[dep.Name]; !ok {
			t.Errorf("unexpected dependency: %s", dep.Name)
		}
		expected[dep.Name] = true
	}

	for name, found := range expected {
		if !found {
			t.Errorf("missing dependency: %s", name)
		}
	}
}

func TestDependenciesHaveMinVersions(t *testing.T) {
	for _, dep := range Dependencies {
		if dep.MinVersion == "" {
			t.Errorf("dependency %s has no MinVersion", dep.Name)
		}
		if dep.Command == "" {
			t.Errorf("dependency %s has no Command", dep.Name)
		}
		if dep.VersionFlag == "" {
			t.Errorf("dependency %s has no VersionFlag", dep.Name)
		}
	}
}
