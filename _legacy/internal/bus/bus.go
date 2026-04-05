package bus

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go"
)

// Bus wraps a NATS connection with typed publish/subscribe helpers.
type Bus struct {
	conn   *nats.Conn
	logger *log.Logger
}

// Options configures the NATS connection.
type Options struct {
	URL string // e.g. "nats://localhost:4222"
}

// DefaultURL is the default NATS server address.
const DefaultURL = "nats://localhost:4222"

// Connect establishes a connection to NATS with auto-reconnect.
func Connect(opts Options, logger *log.Logger) (*Bus, error) {
	if opts.URL == "" {
		opts.URL = DefaultURL
	}

	nc, err := nats.Connect(opts.URL,
		nats.Name("jib"),
		nats.ReconnectWait(2*time.Second),
		nats.MaxReconnects(-1), // reconnect forever
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			if err != nil {
				logger.Printf("bus: disconnected: %v", err)
			}
		}),
		nats.ReconnectHandler(func(_ *nats.Conn) {
			logger.Println("bus: reconnected")
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("connecting to NATS at %s: %w", opts.URL, err)
	}

	logger.Printf("bus: connected to %s", opts.URL)
	return &Bus{conn: nc, logger: logger}, nil
}

// ConnectWithRetry connects to NATS, retrying every 2s until successful.
// Intended for long-running services (deployer, watcher).
func ConnectWithRetry(opts Options, logger *log.Logger) *Bus {
	for {
		b, err := Connect(opts, logger)
		if err == nil {
			return b
		}
		logger.Printf("bus: connect failed, retrying in 2s: %v", err)
		time.Sleep(2 * time.Second)
	}
}

// Close drains the connection and closes it.
func (b *Bus) Close() {
	if b.conn != nil {
		_ = b.conn.Drain()
	}
}

// Publish sends a message to a subject. The msg must have a Subject() method.
func (b *Bus) Publish(subject string, msg interface{}) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshaling message: %w", err)
	}
	return b.conn.Publish(subject, data)
}

// Request sends a message and waits for a reply (for command ACKs).
func (b *Bus) Request(subject string, msg interface{}, timeout time.Duration) (*nats.Msg, error) {
	data, err := json.Marshal(msg)
	if err != nil {
		return nil, fmt.Errorf("marshaling message: %w", err)
	}
	return b.conn.Request(subject, data, timeout)
}

// Handler is a function that processes a raw NATS message.
type Handler func(subject string, data []byte) error

// Subscribe registers a handler for a subject pattern (supports wildcards).
func (b *Bus) Subscribe(subject string, handler Handler) (*nats.Subscription, error) {
	return b.conn.Subscribe(subject, func(msg *nats.Msg) {
		if err := handler(msg.Subject, msg.Data); err != nil {
			b.logger.Printf("bus: handler error on %s: %v", msg.Subject, err)
		}
	})
}

// ReplyHandler processes a message and returns a reply value to be
// JSON-marshaled and sent back on the NATS reply subject. Handlers own
// their error shape: any expected failure must be expressed as a valid
// reply value (nil error). Returning a non-nil error is reserved for
// truly unexpected failures — the bus logs the error and does NOT send a
// reply, which callers experience as a request timeout.
type ReplyHandler func(subject string, data []byte) (interface{}, error)

// QueueSubscribeReply registers a reply handler with a queue group.
// The bus is agnostic to reply types — protocol-specific wrappers (see
// internal/deployrpc.HandleCommand) compose on top to encode typed ACKs.
func (b *Bus) QueueSubscribeReply(subject, queue string, handler ReplyHandler) (*nats.Subscription, error) {
	return b.conn.QueueSubscribe(subject, queue, func(msg *nats.Msg) {
		reply, err := handler(msg.Subject, msg.Data)
		if err != nil {
			b.logger.Printf("bus: reply handler error on %s: %v", msg.Subject, err)
			return
		}
		if msg.Reply == "" || reply == nil {
			return
		}
		replyData, marshalErr := json.Marshal(reply)
		if marshalErr != nil {
			b.logger.Printf("bus: marshal reply error: %v", marshalErr)
			return
		}
		if pubErr := msg.Respond(replyData); pubErr != nil {
			b.logger.Printf("bus: respond error: %v", pubErr)
		}
	})
}
