package notify

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// mockNotifier implements Notifier for testing.
type mockNotifier struct {
	name   string
	called bool
	err    error
}

func (m *mockNotifier) Name() string { return m.name }
func (m *mockNotifier) Send(_ context.Context, _ Event) error {
	m.called = true
	return m.err
}

func TestEventSummary(t *testing.T) {
	tests := []struct {
		name string
		ev   Event
		want string
	}{
		{
			name: "deploy success with autodeploy",
			ev:   Event{App: "myapp", Type: "deploy", SHA: "abc1234567", Status: "success", Trigger: "autodeploy"},
			want: "✓ deploy myapp abc1234 (autodeploy)",
		},
		{
			name: "deploy failure with error",
			ev:   Event{App: "myapp", Type: "deploy", SHA: "abc1234", Status: "failure", Error: "migrations error"},
			want: "✗ deploy myapp abc1234 failed: migrations error",
		},
		{
			name: "rollback success manual",
			ev:   Event{App: "otherapp", Type: "rollback", SHA: "def5678", Status: "success", Trigger: "manual"},
			want: "✓ rollback otherapp def5678 (manual)",
		},
		{
			name: "backup success no app",
			ev:   Event{Type: "backup", Status: "success"},
			want: "✓ backup",
		},
		{
			name: "container crash",
			ev:   Event{App: "myapp", Type: "container_crash", Status: "failure", Error: "OOM killed"},
			want: "✗ container_crash myapp failed: OOM killed",
		},
		{
			name: "cert expiry warning",
			ev:   Event{App: "myapp", Type: "cert_expiry", Status: "success"},
			want: "✓ cert_expiry myapp",
		},
		{
			name: "deploy failure no error message",
			ev:   Event{App: "myapp", Type: "deploy", Status: "failure"},
			want: "✗ deploy myapp failed",
		},
		{
			name: "short sha",
			ev:   Event{App: "x", Type: "deploy", SHA: "abc"},
			want: "✓ deploy x abc",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.ev.Summary()
			if got != tc.want {
				t.Errorf("Summary() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestMultiSendAllCalled(t *testing.T) {
	m1 := &mockNotifier{name: "one"}
	m2 := &mockNotifier{name: "two", err: errors.New("boom")}
	m3 := &mockNotifier{name: "three"}

	multi := NewMulti(m1, m2, m3)
	err := multi.Send(context.Background(), Event{Type: "deploy"})

	if !m1.called {
		t.Error("notifier one was not called")
	}
	if !m2.called {
		t.Error("notifier two was not called")
	}
	if !m3.called {
		t.Error("notifier three was not called")
	}

	if err == nil {
		t.Fatal("expected error from failing notifier")
	}
	if !strings.Contains(err.Error(), "two") {
		t.Errorf("error should mention failing notifier name, got: %s", err.Error())
	}
	if !strings.Contains(err.Error(), "boom") {
		t.Errorf("error should contain original error, got: %s", err.Error())
	}
}

func TestMultiSendNoNotifiers(t *testing.T) {
	multi := NewMulti()
	err := multi.Send(context.Background(), Event{Type: "deploy"})
	if err != nil {
		t.Errorf("expected nil error for empty Multi, got: %v", err)
	}
}

func TestMultiSendAllSucceed(t *testing.T) {
	m1 := &mockNotifier{name: "a"}
	m2 := &mockNotifier{name: "b"}
	multi := NewMulti(m1, m2)
	err := multi.Send(context.Background(), Event{Type: "backup"})
	if err != nil {
		t.Errorf("expected nil error, got: %v", err)
	}
	if !m1.called || !m2.called {
		t.Error("not all notifiers were called")
	}
}

func TestMultiSendSetsTimestamp(t *testing.T) {
	mn := &mockNotifier{name: "cap"}
	multi := NewMulti(mn)
	err := multi.Send(context.Background(), Event{Type: "deploy"})
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestSendTo(t *testing.T) {
	m1 := &mockNotifier{name: "alpha"}
	m2 := &mockNotifier{name: "beta"}
	m3 := &mockNotifier{name: "gamma"}

	multi := NewMulti(m1, m2, m3)
	err := multi.SendTo(context.Background(), []string{"alpha", "gamma"}, Event{Type: "deploy"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !m1.called {
		t.Error("alpha should have been called")
	}
	if m2.called {
		t.Error("beta should NOT have been called")
	}
	if !m3.called {
		t.Error("gamma should have been called")
	}
}

func TestSendToEmptyNames(t *testing.T) {
	m1 := &mockNotifier{name: "a"}
	multi := NewMulti(m1)
	// Empty names means send to all.
	err := multi.SendTo(context.Background(), nil, Event{Type: "deploy"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !m1.called {
		t.Error("should have sent to all when names is empty")
	}
}

func TestSendForApp(t *testing.T) {
	m1 := &mockNotifier{name: "ops"}
	m2 := &mockNotifier{name: "dev"}
	multi := NewMulti(m1, m2)

	err := multi.SendForApp(context.Background(), []string{"ops"}, Event{Type: "deploy", App: "myapp"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !m1.called {
		t.Error("ops should have been called")
	}
	if m2.called {
		t.Error("dev should NOT have been called")
	}
}

func TestSendForAppEmptyList(t *testing.T) {
	m1 := &mockNotifier{name: "ops"}
	multi := NewMulti(m1)

	err := multi.SendForApp(context.Background(), nil, Event{Type: "deploy", App: "myapp"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if m1.called {
		t.Error("should NOT send when notify list is empty")
	}
}

func TestSendToChannel(t *testing.T) {
	m1 := &mockNotifier{name: "ops"}
	m2 := &mockNotifier{name: "dev"}
	multi := NewMulti(m1, m2)

	err := multi.SendToChannel(context.Background(), "ops", Event{Type: "test"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !m1.called {
		t.Error("ops should have been called")
	}
	if m2.called {
		t.Error("dev should NOT have been called")
	}
}

func TestSendToChannelNotFound(t *testing.T) {
	multi := NewMulti()
	err := multi.SendToChannel(context.Background(), "nonexistent", Event{Type: "test"})
	if err == nil {
		t.Fatal("expected error for nonexistent channel")
	}
}

func TestChannelNames(t *testing.T) {
	m1 := &mockNotifier{name: "alpha"}
	m2 := &mockNotifier{name: "beta"}
	multi := NewMulti(m1, m2)

	names := multi.ChannelNames()
	if len(names) != 2 {
		t.Fatalf("expected 2 names, got %d", len(names))
	}
	if names[0] != "alpha" || names[1] != "beta" {
		t.Errorf("names = %v", names)
	}
}

func TestParseEnvFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.env")

	content := `# comment
TELEGRAM_BOT_TOKEN=abc123
TELEGRAM_CHAT_ID=-1001234567890

EXTRA_KEY = some value
invalid line without equals
`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	env, err := parseEnvFile(path)
	if err != nil {
		t.Fatalf("parseEnvFile error: %v", err)
	}

	if env["TELEGRAM_BOT_TOKEN"] != "abc123" {
		t.Errorf("TELEGRAM_BOT_TOKEN = %q, want %q", env["TELEGRAM_BOT_TOKEN"], "abc123")
	}
	if env["TELEGRAM_CHAT_ID"] != "-1001234567890" {
		t.Errorf("TELEGRAM_CHAT_ID = %q, want %q", env["TELEGRAM_CHAT_ID"], "-1001234567890")
	}
	if env["EXTRA_KEY"] != "some value" {
		t.Errorf("EXTRA_KEY = %q, want %q", env["EXTRA_KEY"], "some value")
	}
	if _, ok := env["# comment"]; ok {
		t.Error("comment should not be parsed as a key")
	}
}

func TestParseEnvFileMissing(t *testing.T) {
	_, err := parseEnvFile("/nonexistent/file.env")
	if err == nil {
		t.Error("expected error for missing file")
	}
}

func TestLoadFromSecretsEmpty(t *testing.T) {
	dir := t.TempDir()
	multi := LoadFromSecrets(dir)
	if len(multi.channels) != 0 {
		t.Errorf("expected 0 notifiers, got %d", len(multi.channels))
	}
	// Send should be a no-op
	err := multi.Send(context.Background(), Event{Type: "deploy"})
	if err != nil {
		t.Errorf("expected nil error from empty Multi, got: %v", err)
	}
}

func TestLoadFromSecretsWithTelegram(t *testing.T) {
	dir := t.TempDir()
	jibDir := filepath.Join(dir, "_jib")
	if err := os.MkdirAll(jibDir, 0o750); err != nil {
		t.Fatal(err)
	}

	content := "TELEGRAM_BOT_TOKEN=mytoken\nTELEGRAM_CHAT_ID=mychat\n"
	if err := os.WriteFile(filepath.Join(jibDir, "telegram.env"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	multi := LoadFromSecrets(dir)
	if len(multi.channels) != 1 {
		t.Fatalf("expected 1 notifier, got %d", len(multi.channels))
	}
	if multi.channels[0].notifier.Name() != "telegram" {
		t.Errorf("expected telegram notifier, got %s", multi.channels[0].notifier.Name())
	}
}

func TestLoadFromSecretsWithAll(t *testing.T) {
	dir := t.TempDir()
	jibDir := filepath.Join(dir, "_jib")
	if err := os.MkdirAll(jibDir, 0o750); err != nil {
		t.Fatal(err)
	}

	for _, f := range []struct {
		name    string
		content string
	}{
		{"telegram.env", "TELEGRAM_BOT_TOKEN=t\nTELEGRAM_CHAT_ID=c\n"},
		{"slack_webhook", "https://hooks.slack.com/test"},
		{"discord_webhook", "https://discord.com/api/webhooks/test"},
		{"webhook_url", "https://example.com/hook"},
	} {
		if err := os.WriteFile(filepath.Join(jibDir, f.name), []byte(f.content), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	multi := LoadFromSecrets(dir)
	if len(multi.channels) != 4 {
		t.Fatalf("expected 4 notifiers, got %d", len(multi.channels))
	}

	names := make(map[string]bool)
	for _, ch := range multi.channels {
		names[ch.notifier.Name()] = true
	}
	for _, want := range []string{"telegram", "slack", "discord", "webhook"} {
		if !names[want] {
			t.Errorf("missing notifier: %s", want)
		}
	}
}

func TestLoadFromSecretsTelegramPartialCreds(t *testing.T) {
	dir := t.TempDir()
	jibDir := filepath.Join(dir, "_jib")
	if err := os.MkdirAll(jibDir, 0o750); err != nil {
		t.Fatal(err)
	}

	// Only token, no chat ID — should not create notifier
	if err := os.WriteFile(filepath.Join(jibDir, "telegram.env"), []byte("TELEGRAM_BOT_TOKEN=t\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	multi := LoadFromSecrets(dir)
	if len(multi.channels) != 0 {
		t.Errorf("expected 0 notifiers with partial telegram creds, got %d", len(multi.channels))
	}
}

func TestLoadChannels(t *testing.T) {
	dir := t.TempDir()
	jibDir := filepath.Join(dir, "_jib")
	if err := os.MkdirAll(jibDir, 0o750); err != nil {
		t.Fatal(err)
	}

	// Write telegram creds
	tgCreds, _ := json.Marshal(map[string]string{"bot_token": "t123", "chat_id": "-100"})
	if err := os.WriteFile(filepath.Join(jibDir, "ops-tg.json"), tgCreds, 0600); err != nil {
		t.Fatal(err)
	}

	// Write slack creds
	slackCreds, _ := json.Marshal(map[string]string{"webhook_url": "https://hooks.slack.com/x"})
	if err := os.WriteFile(filepath.Join(jibDir, "dev-slack.json"), slackCreds, 0600); err != nil {
		t.Fatal(err)
	}

	channels := map[string]ChannelConfig{
		"ops-tg":    {Driver: "telegram"},
		"dev-slack": {Driver: "slack"},
		"missing":   {Driver: "webhook"}, // no creds file
	}

	multi := LoadChannels(dir, channels)
	if len(multi.channels) != 2 {
		t.Fatalf("expected 2 channels, got %d", len(multi.channels))
	}

	names := multi.ChannelNames()
	nameSet := make(map[string]bool)
	for _, n := range names {
		nameSet[n] = true
	}
	if !nameSet["ops-tg"] {
		t.Error("missing ops-tg channel")
	}
	if !nameSet["dev-slack"] {
		t.Error("missing dev-slack channel")
	}
}

func TestWriteAndReadChannelCreds(t *testing.T) {
	dir := t.TempDir()
	creds := map[string]string{"bot_token": "abc", "chat_id": "-123"}

	if err := WriteChannelCreds(dir, "test-tg", creds); err != nil {
		t.Fatalf("write: %v", err)
	}

	got, err := ReadChannelCreds(dir, "test-tg")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if got["bot_token"] != "abc" || got["chat_id"] != "-123" {
		t.Errorf("creds = %v", got)
	}
}

func TestDeleteChannelCreds(t *testing.T) {
	dir := t.TempDir()
	creds := map[string]string{"url": "https://example.com"}
	if err := WriteChannelCreds(dir, "test-hook", creds); err != nil {
		t.Fatal(err)
	}

	if err := DeleteChannelCreds(dir, "test-hook"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err := ReadChannelCreds(dir, "test-hook")
	if err == nil {
		t.Error("expected error after deletion")
	}
}

func TestDeleteChannelCredsNonExistent(t *testing.T) {
	dir := t.TempDir()
	// Should not error for non-existent file.
	if err := DeleteChannelCreds(dir, "nope"); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestEventSummaryTimestampIgnored(t *testing.T) {
	// Timestamp should not appear in summary
	ev := Event{App: "x", Type: "deploy", Status: "success", Timestamp: time.Now()}
	s := ev.Summary()
	if strings.Contains(s, "202") { // year prefix
		t.Errorf("summary should not contain timestamp, got: %s", s)
	}
}
