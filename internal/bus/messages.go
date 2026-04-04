package bus

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// sanitizeToken ensures a value is safe for use in a NATS subject token.
// Removes NATS wildcards and whitespace. Dots are allowed (domains have them;
// app names are already validated as [a-z0-9-]+ by config).
func sanitizeToken(s string) string {
	r := strings.NewReplacer("*", "", ">", "", " ", "-")
	return r.Replace(s)
}

// Message is the base envelope for all NATS messages.
type Message struct {
	ID            string    `json:"id"`
	Version       int       `json:"version"`
	CorrelationID string    `json:"correlation_id,omitempty"`
	Timestamp     time.Time `json:"timestamp"`
	Source        string    `json:"source"`
}

// NewMessage creates a Message with a new UUID, version 1, and current timestamp.
func NewMessage(source string) Message {
	return Message{
		ID:        uuid.NewString(),
		Version:   1,
		Timestamp: time.Now().UTC(),
		Source:    source,
	}
}

// NewCorrelated creates a Message correlated to a parent message.
func NewCorrelated(source string, correlationID string) Message {
	m := NewMessage(source)
	m.CorrelationID = correlationID
	return m
}

// --- Commands ---

// DeployCommand requests a deploy for an app.
type DeployCommand struct {
	Message
	App     string `json:"app"`
	Ref     string `json:"ref,omitempty"`
	Trigger string `json:"trigger"` // "webhook", "autodeploy", "manual"
	User    string `json:"user"`
	Force   bool   `json:"force,omitempty"`
	DryRun  bool   `json:"dry_run,omitempty"`
}

// Subject returns the NATS subject for this command.
func (c DeployCommand) Subject() string {
	return TopicDeployCmd + "." + sanitizeToken(c.App)
}

// Validate checks required fields.
func (c DeployCommand) Validate() error {
	if c.App == "" {
		return fmt.Errorf("app is required")
	}
	if c.Trigger == "" {
		return fmt.Errorf("trigger is required")
	}
	return nil
}

// RollbackCommand requests a rollback for an app.
type RollbackCommand struct {
	Message
	App  string `json:"app"`
	User string `json:"user"`
}

// Subject returns the NATS subject for this command.
func (c RollbackCommand) Subject() string {
	return TopicRollbackCmd + "." + sanitizeToken(c.App)
}

// Validate checks required fields.
func (c RollbackCommand) Validate() error {
	if c.App == "" {
		return fmt.Errorf("app is required")
	}
	return nil
}

// ResumeCommand requests unpinning and resetting failures for an app.
type ResumeCommand struct {
	Message
	App  string `json:"app"`
	User string `json:"user"`
}

// Subject returns the NATS subject for this command.
func (c ResumeCommand) Subject() string {
	return TopicResumeCmd + "." + sanitizeToken(c.App)
}

// Validate checks required fields.
func (c ResumeCommand) Validate() error {
	if c.App == "" {
		return fmt.Errorf("app is required")
	}
	return nil
}

// ConfigReloadCommand requests the daemon to reload its config.
type ConfigReloadCommand struct {
	Message
}

// Subject returns the NATS subject for this command.
func (c ConfigReloadCommand) Subject() string {
	return TopicConfigReload
}

// Validate checks required fields.
func (c ConfigReloadCommand) Validate() error {
	return nil
}

// --- Command ACK ---

// CommandAck is the immediate reply to a command (accepted or rejected).
type CommandAck struct {
	Accepted      bool   `json:"accepted"`
	CorrelationID string `json:"correlation_id"`
	Error         string `json:"error,omitempty"`
}

// --- Events ---

// DeployEvent reports the result of a deploy.
type DeployEvent struct {
	Message
	App         string `json:"app"`
	SHA         string `json:"sha"`
	PreviousSHA string `json:"previous_sha,omitempty"`
	Strategy    string `json:"strategy"`
	Status      string `json:"status"` // "success" or "failure"
	Trigger     string `json:"trigger"`
	User        string `json:"user"`
	Error       string `json:"error,omitempty"`
	DurationMs  int64  `json:"duration_ms"`
}

// Subject returns the NATS subject for this event.
func (e DeployEvent) Subject() string {
	return TopicDeployEvent + "." + sanitizeToken(e.App) + "." + e.Status
}
