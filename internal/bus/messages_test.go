package bus

import (
	"encoding/json"
	"testing"
)

func TestNewMessage(t *testing.T) {
	m := NewMessage("webhook")
	if m.ID == "" {
		t.Error("ID should not be empty")
	}
	if m.Version != 1 {
		t.Errorf("Version = %d, want 1", m.Version)
	}
	if m.Source != "webhook" {
		t.Errorf("Source = %q, want webhook", m.Source)
	}
	if m.Timestamp.IsZero() {
		t.Error("Timestamp should not be zero")
	}
}

func TestNewCorrelated(t *testing.T) {
	m := NewCorrelated("daemon", "parent-123")
	if m.CorrelationID != "parent-123" {
		t.Errorf("CorrelationID = %q, want parent-123", m.CorrelationID)
	}
}

func TestDeployCommandSubject(t *testing.T) {
	cmd := DeployCommand{App: "myapp"}
	if cmd.Subject() != "jib.command.deploy.myapp" {
		t.Errorf("Subject = %q", cmd.Subject())
	}
}

func TestDeployCommandValidate(t *testing.T) {
	// Missing app
	cmd := DeployCommand{Trigger: "webhook"}
	if err := cmd.Validate(); err == nil {
		t.Error("expected error for missing app")
	}
	// Missing trigger
	cmd = DeployCommand{App: "myapp"}
	if err := cmd.Validate(); err == nil {
		t.Error("expected error for missing trigger")
	}
	// Valid
	cmd = DeployCommand{App: "myapp", Trigger: "webhook"}
	if err := cmd.Validate(); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestDeployEventSubject(t *testing.T) {
	ev := DeployEvent{App: "myapp", Status: StatusSuccess}
	if ev.Subject() != "jib.event.deploy.myapp.success" {
		t.Errorf("Subject = %q", ev.Subject())
	}
}

func TestMessageRoundTrip(t *testing.T) {
	cmd := DeployCommand{
		Message: NewMessage("webhook"),
		App:     "myapp",
		Trigger: "webhook",
		User:    "github",
		Force:   true,
	}

	data, err := json.Marshal(cmd)
	if err != nil {
		t.Fatal(err)
	}

	var decoded DeployCommand
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}

	if decoded.App != "myapp" {
		t.Errorf("App = %q", decoded.App)
	}
	if decoded.Source != "webhook" {
		t.Errorf("Source = %q", decoded.Source)
	}
	if !decoded.Force {
		t.Error("Force should be true")
	}
	if decoded.ID == "" {
		t.Error("ID lost in round-trip")
	}
}

func TestSubjectSanitization(t *testing.T) {
	// Wildcards should be stripped
	cmd := DeployCommand{App: "foo*bar"}
	if got := cmd.Subject(); got != "jib.command.deploy.foobar" {
		t.Errorf("Subject() = %q, want wildcards stripped", got)
	}

	// Dots are allowed in deploy event subjects
	ev := DeployEvent{App: "api.example.com", Status: StatusSuccess}
	if got := ev.Subject(); got != "jib.event.deploy.api.example.com.success" {
		t.Errorf("Subject() = %q", got)
	}
}

func TestCommandAckRoundTrip(t *testing.T) {
	ack := CommandAck{Accepted: false, CorrelationID: "abc", Error: "already deploying"}
	data, err := json.Marshal(ack)
	if err != nil {
		t.Fatal(err)
	}

	var decoded CommandAck
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Accepted {
		t.Error("should not be accepted")
	}
	if decoded.Error != "already deploying" {
		t.Errorf("Error = %q", decoded.Error)
	}
}
