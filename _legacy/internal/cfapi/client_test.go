package cfapi

import "testing"

func TestBaseDomain(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"example.com", "example.com"},
		{"api.example.com", "example.com"},
		{"sub.api.example.com", "example.com"},
		{"localhost", "localhost"},
	}
	for _, tt := range tests {
		got := baseDomain(tt.input)
		if got != tt.want {
			t.Errorf("baseDomain(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}
