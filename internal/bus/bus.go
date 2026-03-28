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
	URL      string // e.g. "nats://localhost:4222"
	User     string // NATS user, empty = no auth
	Password string // NATS password
}

// DefaultURL is the default NATS server address.
const DefaultURL = "nats://localhost:4222"

// Connect establishes a connection to NATS with auto-reconnect.
func Connect(opts Options, logger *log.Logger) (*Bus, error) {
	if opts.URL == "" {
		opts.URL = DefaultURL
	}

	natsOpts := []nats.Option{
		nats.Name("jib"),
		nats.ReconnectWait(2 * time.Second),
		nats.MaxReconnects(-1), // reconnect forever
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			if err != nil {
				logger.Printf("bus: disconnected: %v", err)
			}
		}),
		nats.ReconnectHandler(func(_ *nats.Conn) {
			logger.Println("bus: reconnected")
		}),
	}

	if opts.User != "" {
		natsOpts = append(natsOpts, nats.UserInfo(opts.User, opts.Password))
	}

	nc, err := nats.Connect(opts.URL, natsOpts...)
	if err != nil {
		return nil, fmt.Errorf("connecting to NATS at %s: %w", opts.URL, err)
	}

	logger.Printf("bus: connected to %s", opts.URL)
	return &Bus{conn: nc, logger: logger}, nil
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

// ReplyHandler is a function that processes a message and returns a reply.
type ReplyHandler func(subject string, data []byte) (interface{}, error)

// SubscribeReply registers a handler for request-reply patterns.
func (b *Bus) SubscribeReply(subject string, handler ReplyHandler) (*nats.Subscription, error) {
	return b.conn.Subscribe(subject, func(msg *nats.Msg) {
		reply, err := handler(msg.Subject, msg.Data)
		if err != nil {
			b.logger.Printf("bus: reply handler error on %s: %v", msg.Subject, err)
			reply = CommandAck{Accepted: false, Error: err.Error()}
		}
		if msg.Reply != "" {
			replyData, marshalErr := json.Marshal(reply)
			if marshalErr != nil {
				b.logger.Printf("bus: marshal reply error: %v", marshalErr)
				return
			}
			if pubErr := msg.Respond(replyData); pubErr != nil {
				b.logger.Printf("bus: respond error: %v", pubErr)
			}
		}
	})
}

// Decode unmarshals a NATS message payload into the given type.
func Decode[T any](data []byte) (T, error) {
	var msg T
	err := json.Unmarshal(data, &msg)
	return msg, err
}
