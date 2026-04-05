package deployrpc

import (
	"github.com/hexnickk/jib/internal/bus"
	"github.com/nats-io/nats.go"
)

// CommandHandler processes a command message and returns the CommandAck
// to send back to the caller. Handlers own their error shape — any failure
// must be expressed as a CommandAck with Accepted=false, not a returned
// error. Returning an error from the handler is reserved for truly
// unexpected failures (e.g. nil pointer) and results in no reply being
// sent, which the caller will experience as a timeout.
type CommandHandler func(subject string, data []byte) (CommandAck, error)

// HandleCommand registers a queue-group handler for a command topic.
// It wraps bus.QueueSubscribeReply with CommandAck marshaling so deployer
// handlers can return typed CommandAck values directly.
func HandleCommand(b *bus.Bus, subject, queue string, h CommandHandler) (*nats.Subscription, error) {
	return b.QueueSubscribeReply(subject, queue, func(subj string, data []byte) (interface{}, error) {
		ack, err := h(subj, data)
		if err != nil {
			// Unexpected handler error: surface via CommandAck so the caller
			// sees a structured failure instead of a request timeout.
			return CommandAck{Accepted: false, Error: err.Error()}, nil
		}
		return ack, nil
	})
}
