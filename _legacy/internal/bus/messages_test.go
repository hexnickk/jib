package bus

import "testing"

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
