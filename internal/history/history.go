// Package history provides an append-only event log per app.
// Events are stored as JSON lines in /opt/jib/logs/<app>.jsonl.
package history

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// EventType enumerates the kinds of events we log.
const (
	EventDeploy       = "deploy"
	EventRollback     = "rollback"
	EventBackup       = "backup"
	EventRestore      = "restore"
	EventConfigChange = "config_change"
)

// Event represents a single logged event.
type Event struct {
	Timestamp   time.Time `json:"timestamp"`
	Type        string    `json:"type"`
	SHA         string    `json:"sha"`
	PreviousSHA string    `json:"previous_sha,omitempty"`
	Trigger     string    `json:"trigger,omitempty"`
	User        string    `json:"user,omitempty"`
	Status      string    `json:"status"`
	Error       string    `json:"error,omitempty"`
	DurationMs  int64     `json:"duration_ms,omitempty"`
}

// Logger handles reading and writing history events.
type Logger struct {
	LogDir string // e.g. /opt/jib/logs
}

// NewLogger creates a Logger for the given log directory.
func NewLogger(logDir string) *Logger {
	return &Logger{LogDir: logDir}
}

// logPath returns the path to the JSONL file for an app.
func (l *Logger) logPath(app string) string {
	return filepath.Join(l.LogDir, app+".jsonl")
}

// Append writes an event as a JSON line to the app's log file.
// Creates the log directory and file if they don't exist.
func (l *Logger) Append(app string, event Event) error {
	if err := os.MkdirAll(l.LogDir, 0o750); err != nil {
		return fmt.Errorf("creating log dir: %w", err)
	}

	f, err := os.OpenFile(l.logPath(app), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("opening log file: %w", err)
	}
	defer func() { _ = f.Close() }()

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshaling event: %w", err)
	}

	if _, err := f.Write(append(data, '\n')); err != nil {
		return fmt.Errorf("writing event: %w", err)
	}

	return nil
}

// Read returns the last N events for an app. If limit <= 0, returns all events.
func (l *Logger) Read(app string, limit int) ([]Event, error) {
	f, err := os.Open(l.logPath(app))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("opening log file: %w", err)
	}
	defer func() { _ = f.Close() }()

	var events []Event
	scanner := bufio.NewScanner(f)
	// Allow for large lines (1MB max).
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var ev Event
		if err := json.Unmarshal(line, &ev); err != nil {
			// Skip malformed lines.
			continue
		}
		events = append(events, ev)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading log file: %w", err)
	}

	if limit > 0 && len(events) > limit {
		events = events[len(events)-limit:]
	}

	return events, nil
}
