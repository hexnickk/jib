package notify

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// LoadFromSecrets builds a Multi notifier by checking for secrets files
// in <secretsDir>/_jib/. If no secrets files exist, returns an empty Multi
// whose Send is a no-op.
func LoadFromSecrets(secretsDir string) *Multi {
	dir := filepath.Join(secretsDir, "_jib")
	var notifiers []Notifier

	// Telegram
	if env, err := parseEnvFile(filepath.Join(dir, "telegram.env")); err == nil {
		token := env["TELEGRAM_BOT_TOKEN"]
		chatID := env["TELEGRAM_CHAT_ID"]
		if token != "" && chatID != "" {
			notifiers = append(notifiers, NewTelegram(token, chatID))
		}
	}

	// Slack
	if url, err := readFileString(filepath.Join(dir, "slack_webhook")); err == nil && url != "" {
		notifiers = append(notifiers, NewSlack(url))
	}

	// Discord
	if url, err := readFileString(filepath.Join(dir, "discord_webhook")); err == nil && url != "" {
		notifiers = append(notifiers, NewDiscord(url))
	}

	// Generic webhook
	if url, err := readFileString(filepath.Join(dir, "webhook_url")); err == nil && url != "" {
		notifiers = append(notifiers, NewWebhook(url))
	}

	return NewMulti(notifiers...)
}

// parseEnvFile reads a file of KEY=VALUE lines. Blank lines and lines
// starting with # are ignored.
func parseEnvFile(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	env := make(map[string]string)
	scanner := bufio.NewScanner(f)
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
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}
