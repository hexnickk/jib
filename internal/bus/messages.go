package bus

import (
	"time"

	"github.com/google/uuid"
)

// Message is the base envelope for all NATS messages. Service-specific
// message types embed it to inherit ID/CorrelationID/Timestamp/Source.
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
