package notify

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/hexnickk/jib/internal/config"
)

// ChannelConfig mirrors config.NotificationChannel to avoid config importing notify.
type ChannelConfig struct {
	Driver string
}

// LoadChannels builds a Multi notifier from named channel configs and their
// credential files in /opt/jib/secrets/_jib/notify/<name>.json.
func LoadChannels(channels map[string]ChannelConfig) *Multi {
	var chs []namedNotifier

	for name, ch := range channels {
		credPath := config.CredsPath("notify", name+".json")
		data, err := os.ReadFile(credPath) //nolint:gosec // path is constructed from trusted secrets directory
		if err != nil {
			// No credentials file — skip silently.
			continue
		}

		var creds map[string]string
		if err := json.Unmarshal(data, &creds); err != nil {
			continue
		}

		var n Notifier
		switch ch.Driver {
		case "telegram":
			token := creds["bot_token"]
			chatID := creds["chat_id"]
			if token == "" || chatID == "" {
				continue
			}
			n = NewTelegram(token, chatID)
		default:
			continue
		}

		chs = append(chs, namedNotifier{name: name, notifier: n})
	}

	return &Multi{channels: chs}
}

// ReadChannelCreds reads the credential JSON for a named channel.
func ReadChannelCreds(name string) (map[string]string, error) {
	path := config.CredsPath("notify", name+".json")
	data, err := os.ReadFile(path) //nolint:gosec // path is constructed from trusted secrets directory
	if err != nil {
		return nil, fmt.Errorf("reading credentials for %q: %w", name, err)
	}
	var creds map[string]string
	if err := json.Unmarshal(data, &creds); err != nil {
		return nil, fmt.Errorf("parsing credentials for %q: %w", name, err)
	}
	return creds, nil
}

// WriteChannelCreds writes the credential JSON for a named channel.
func WriteChannelCreds(name string, creds map[string]string) error {
	path := config.CredsPath("notify", name+".json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("creating secrets dir: %w", err)
	}
	data, err := json.MarshalIndent(creds, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling credentials: %w", err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("writing credentials for %q: %w", name, err)
	}
	return nil
}

// DeleteChannelCreds removes the credential file for a named channel.
func DeleteChannelCreds(name string) error {
	path := config.CredsPath("notify", name+".json")
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("removing credentials for %q: %w", name, err)
	}
	return nil
}

// parseEnvFile reads a file of KEY=VALUE lines. Blank lines and lines
// starting with # are ignored.
func parseEnvFile(path string) (map[string]string, error) {
	f, err := os.Open(path) //nolint:gosec // path is constructed from trusted secrets directory
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()

	return parseEnvReader(f)
}

func parseEnvReader(r io.Reader) (map[string]string, error) {
	env := make(map[string]string)
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		env[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return env, nil
}
