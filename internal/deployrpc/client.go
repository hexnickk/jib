package deployrpc

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hexnickk/jib/internal/bus"
)

// Client is the CLI-side helper for sending commands to jib-deployer.
// It wraps a generic *bus.Bus and handles the request/ACK/event dance so
// callers don't need to know the wire protocol.
type Client struct {
	bus *bus.Bus
}

// NewClient returns a deployrpc Client bound to the given bus.
func NewClient(b *bus.Bus) *Client { return &Client{bus: b} }

// DeployAndWait sends a command via NATS Request (for ACK), then waits for
// a DeployEvent with the matching correlationID on the app's event topic.
// The caller must set CorrelationID on the command before calling.
func (c *Client) DeployAndWait(subject string, cmd any, correlationID string, app string, timeout time.Duration) (*DeployEvent, error) {
	// Subscribe to deploy events BEFORE sending.
	eventSubject := TopicDeployEvent + "." + sanitizeToken(app) + ".>"
	eventCh := make(chan *DeployEvent, 1)
	sub, err := c.bus.Subscribe(eventSubject, func(_ string, data []byte) error {
		var ev DeployEvent
		if jsonErr := json.Unmarshal(data, &ev); jsonErr != nil {
			return nil
		}
		if ev.CorrelationID == correlationID {
			select {
			case eventCh <- &ev:
			default:
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("subscribing to deploy events: %w", err)
	}
	defer func() { _ = sub.Unsubscribe() }()

	// Send command and wait for ACK.
	ackReply, err := c.bus.Request(subject, cmd, 5*time.Second)
	if err != nil {
		return nil, fmt.Errorf("sending command (is jib-deployer running? check 'systemctl status jib-deployer'): %w", err)
	}

	var ack CommandAck
	if err := json.Unmarshal(ackReply.Data, &ack); err != nil {
		return nil, fmt.Errorf("decoding command ACK: %w", err)
	}
	if !ack.Accepted {
		return nil, fmt.Errorf("command rejected: %s", ack.Error)
	}

	// Wait for deploy result event.
	select {
	case ev := <-eventCh:
		return ev, nil
	case <-time.After(timeout):
		return nil, fmt.Errorf("timeout waiting for deploy result (waited %s)", timeout)
	}
}

// RequestAck sends a command via NATS Request and returns the ACK.
// Used for commands that don't produce deploy events (like resume).
func (c *Client) RequestAck(subject string, cmd any) (*CommandAck, error) {
	reply, err := c.bus.Request(subject, cmd, 5*time.Second)
	if err != nil {
		return nil, fmt.Errorf("sending command (is jib-deployer running?): %w", err)
	}
	var ack CommandAck
	if err := json.Unmarshal(reply.Data, &ack); err != nil {
		return nil, fmt.Errorf("decoding ACK: %w", err)
	}
	return &ack, nil
}
