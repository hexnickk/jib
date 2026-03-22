// Package notify provides multi-channel deployment notifications.
package notify

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Event represents a notification event.
type Event struct {
	App       string    `json:"app,omitempty"`
	Type      string    `json:"event"`                 // deploy, rollback, restart, backup, cert_expiry, disk_warning, container_crash, serve_status, autodeploy_paused
	SHA       string    `json:"sha,omitempty"`
	Trigger   string    `json:"trigger,omitempty"`      // manual, autodeploy
	User      string    `json:"user,omitempty"`
	Status    string    `json:"status,omitempty"`       // success, failure, start
	Error     string    `json:"error,omitempty"`
	Timestamp time.Time `json:"timestamp"`
	Machine   string    `json:"machine,omitempty"`
}

// Summary returns a one-line human-readable summary of the event.
func (e Event) Summary() string {
	var b strings.Builder

	switch e.Status {
	case "failure":
		b.WriteString("✗ ")
	case "start":
		b.WriteString("▶ ")
	default:
		b.WriteString("✓ ")
	}

	b.WriteString(e.Type)

	if e.App != "" {
		b.WriteString(" ")
		b.WriteString(e.App)
	}

	if e.SHA != "" {
		sha := e.SHA
		if len(sha) > 7 {
			sha = sha[:7]
		}
		b.WriteString(" ")
		b.WriteString(sha)
	}

	if e.Status == "failure" {
		b.WriteString(" failed")
		if e.Error != "" {
			b.WriteString(": ")
			b.WriteString(e.Error)
		}
	}

	if e.Trigger != "" {
		fmt.Fprintf(&b, " (%s)", e.Trigger)
	}

	return b.String()
}

// Notifier sends notifications to a single channel.
type Notifier interface {
	Name() string
	Send(ctx context.Context, event Event) error
}

// Multi fans out notifications to multiple notifiers.
// If no notifiers are configured, Send is a no-op.
type Multi struct {
	notifiers []Notifier
}

// NewMulti creates a Multi that fans out to the given notifiers.
func NewMulti(notifiers ...Notifier) *Multi {
	return &Multi{notifiers: notifiers}
}

// Send sends the event to all notifiers. It does not stop on first failure
// and returns a joined error if any notifier failed.
func (m *Multi) Send(ctx context.Context, event Event) error {
	if len(m.notifiers) == 0 {
		return nil
	}

	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}

	var errs []error
	for _, n := range m.notifiers {
		if err := n.Send(ctx, event); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", n.Name(), err))
		}
	}

	return errors.Join(errs...)
}
