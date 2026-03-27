package notify

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ChannelConfig mirrors config.NotificationChannel but avoids circular imports.
type ChannelConfig struct {
	Driver string
}

// LoadChannels builds a Multi notifier from named channel configs and their
// credential files in secretsDir (e.g. /opt/jib/secrets/_jib/<name>.json).
func LoadChannels(secretsDir string, channels map[string]ChannelConfig) *Multi {
	dir := filepath.Join(secretsDir, "_jib")
	var chs []namedNotifier

	for name, ch := range channels {
		credPath := filepath.Join(dir, name+".json")
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
		case "slack":
			url := creds["webhook_url"]
			if url == "" {
				continue
			}
			n = NewSlack(url)
		case "discord":
			url := creds["webhook_url"]
			if url == "" {
				continue
			}
			n = NewDiscord(url)
		case "webhook":
			url := creds["url"]
			if url == "" {
				continue
			}
			n = NewWebhook(url)
		default:
			continue
		}

		chs = append(chs, namedNotifier{name: name, notifier: n})
	}

	return &Multi{channels: chs}
}

// LoadFromSecrets is the legacy loader for backward compatibility.
// It checks for old-format secrets files. New code should use LoadChannels.
func LoadFromSecrets(secretsDir string) *Multi {
	dir := filepath.Join(secretsDir, "_jib")
	var chs []namedNotifier

	// Telegram (old format: telegram.env)
	if env, err := parseEnvFile(filepath.Join(dir, "telegram.env")); err == nil {
		token := env["TELEGRAM_BOT_TOKEN"]
		chatID := env["TELEGRAM_CHAT_ID"]
		if token != "" && chatID != "" {
			chs = append(chs, namedNotifier{name: "telegram", notifier: NewTelegram(token, chatID)})
		}
	}

	// Slack
	if url, err := readFileString(filepath.Join(dir, "slack_webhook")); err == nil && url != "" {
		chs = append(chs, namedNotifier{name: "slack", notifier: NewSlack(url)})
	}

	// Discord
	if url, err := readFileString(filepath.Join(dir, "discord_webhook")); err == nil && url != "" {
		chs = append(chs, namedNotifier{name: "discord", notifier: NewDiscord(url)})
	}

	// Generic webhook
	if url, err := readFileString(filepath.Join(dir, "webhook_url")); err == nil && url != "" {
		chs = append(chs, namedNotifier{name: "webhook", notifier: NewWebhook(url)})
	}

	return &Multi{channels: chs}
}

// ReadChannelCreds reads the credential JSON for a named channel.
func ReadChannelCreds(secretsDir, name string) (map[string]string, error) {
	path := filepath.Join(secretsDir, "_jib", name+".json")
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
func WriteChannelCreds(secretsDir, name string, creds map[string]string) error {
	dir := filepath.Join(secretsDir, "_jib")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("creating secrets dir: %w", err)
	}
	data, err := json.MarshalIndent(creds, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling credentials: %w", err)
	}
	path := filepath.Join(dir, name+".json")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("writing credentials for %q: %w", name, err)
	}
	return nil
}

// DeleteChannelCreds removes the credential file for a named channel.
func DeleteChannelCreds(secretsDir, name string) error {
	path := filepath.Join(secretsDir, "_jib", name+".json")
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

// readFileString reads a file and returns its trimmed content.
func readFileString(path string) (string, error) {
	data, err := os.ReadFile(path) //nolint:gosec // path constructed from trusted secrets directory
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}
