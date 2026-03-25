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
	Type      string    `json:"event"` // deploy, rollback, restart, backup, cert_expiry, disk_warning, container_crash, serve_status, autodeploy_paused
	SHA       string    `json:"sha,omitempty"`
	Trigger   string    `json:"trigger,omitempty"` // manual, autodeploy
	User      string    `json:"user,omitempty"`
	Status    string    `json:"status,omitempty"` // success, failure, start
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

// namedNotifier pairs a channel name with its notifier.
type namedNotifier struct {
	name     string
	notifier Notifier
}

// Multi fans out notifications to multiple named channels.
// If no notifiers are configured, Send is a no-op.
type Multi struct {
	channels []namedNotifier
}

// NewMulti creates a Multi that fans out to the given notifiers.
// Each notifier is registered under its Name().
func NewMulti(notifiers ...Notifier) *Multi {
	var chs []namedNotifier
	for _, n := range notifiers {
		chs = append(chs, namedNotifier{name: n.Name(), notifier: n})
	}
	return &Multi{channels: chs}
}

// ChannelNames returns the names of all configured channels.
func (m *Multi) ChannelNames() []string {
	var names []string
	for _, ch := range m.channels {
		names = append(names, ch.name)
	}
	return names
}

// Send sends the event to all notifiers. It does not stop on first failure
// and returns a joined error if any notifier failed.
func (m *Multi) Send(ctx context.Context, event Event) error {
	if len(m.channels) == 0 {
		return nil
	}

	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}

	var errs []error
	for _, ch := range m.channels {
		if err := ch.notifier.Send(ctx, event); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", ch.name, err))
		}
	}

	return errors.Join(errs...)
}

// SendTo sends the event only to the named channels. If names is empty,
// it sends to all channels (same as Send).
func (m *Multi) SendTo(ctx context.Context, names []string, event Event) error {
	if len(names) == 0 {
		return m.Send(ctx, event)
	}

	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}

	nameSet := make(map[string]bool, len(names))
	for _, n := range names {
		nameSet[n] = true
	}

	var errs []error
	for _, ch := range m.channels {
		if !nameSet[ch.name] {
			continue
		}
		if err := ch.notifier.Send(ctx, event); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", ch.name, err))
		}
	}

	return errors.Join(errs...)
}

// SendForApp sends the event to channels listed in the app's notify list.
// If notifyList is empty, notification is skipped (not sent to all).
func (m *Multi) SendForApp(ctx context.Context, notifyList []string, event Event) error {
	if len(notifyList) == 0 {
		return nil
	}
	return m.SendTo(ctx, notifyList, event)
}

// SendToChannel sends a test event to a single named channel.
// Returns an error if the channel is not found.
func (m *Multi) SendToChannel(ctx context.Context, name string, event Event) error {
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}

	for _, ch := range m.channels {
		if ch.name == name {
			return ch.notifier.Send(ctx, event)
		}
	}
	return fmt.Errorf("channel %q not found", name)
}
