package bus

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
)

// DeployAndWait sends a command via NATS Request (for ACK), then waits for
// a DeployEvent with the matching correlationID on the app's event topic.
// The caller must set CorrelationID on the command before calling.
func (b *Bus) DeployAndWait(subject string, cmd any, correlationID string, app string, timeout time.Duration) (*DeployEvent, error) {
	// Subscribe to deploy events BEFORE sending
	eventSubject := TopicDeployEvent + "." + sanitizeToken(app) + ".>"
	eventCh := make(chan *DeployEvent, 1)
	sub, err := b.conn.Subscribe(eventSubject, func(msg *nats.Msg) {
		var ev DeployEvent
		if jsonErr := json.Unmarshal(msg.Data, &ev); jsonErr != nil {
			return
		}
		if ev.CorrelationID == correlationID {
			select {
			case eventCh <- &ev:
			default:
			}
		}
	})
	if err != nil {
		return nil, fmt.Errorf("subscribing to deploy events: %w", err)
	}
	defer func() { _ = sub.Unsubscribe() }()

	// Send command and wait for ACK
	ackReply, err := b.Request(subject, cmd, 5*time.Second)
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

	// Wait for deploy result event
	select {
	case ev := <-eventCh:
		return ev, nil
	case <-time.After(timeout):
		return nil, fmt.Errorf("timeout waiting for deploy result (waited %s)", timeout)
	}
}

// RequestAck sends a command via NATS Request and returns the ACK.
// Used for commands that don't produce deploy events (like resume).
func (b *Bus) RequestAck(subject string, cmd any) (*CommandAck, error) {
	reply, err := b.Request(subject, cmd, 5*time.Second)
	if err != nil {
		return nil, fmt.Errorf("sending command (is jib-deployer running?): %w", err)
	}
	var ack CommandAck
	if err := json.Unmarshal(reply.Data, &ack); err != nil {
		return nil, fmt.Errorf("decoding ACK: %w", err)
	}
	return &ack, nil
}
