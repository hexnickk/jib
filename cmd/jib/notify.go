package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/notify"
	"github.com/spf13/cobra"
)

func registerNotifyCommands(rootCmd *cobra.Command) {
	// jib notify
	notifyCmd := &cobra.Command{
		Use:   "notify",
		Short: "Manage notification channels",
	}

	// jib notify list
	notifyCmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "Show all configured notification channels",
		RunE:  runNotifyList,
	})

	// jib notify add <name> --driver <driver>
	addCmd := &cobra.Command{
		Use:   "add <name>",
		Short: "Add a notification channel (generic)",
		Args:  cobra.ExactArgs(1),
		RunE:  runNotifyAdd,
	}
	addCmd.Flags().String("driver", "", "Channel driver: telegram, slack, discord, webhook")
	addCmd.Flags().String("url", "", "Webhook URL (for webhook, slack, discord drivers)")
	notifyCmd.AddCommand(addCmd)

	// jib notify remove <name>
	notifyCmd.AddCommand(&cobra.Command{
		Use:   "remove <name>",
		Short: "Remove a notification channel and its credentials",
		Args:  cobra.ExactArgs(1),
		RunE:  runNotifyRemove,
	})

	// jib notify test <name>
	notifyCmd.AddCommand(&cobra.Command{
		Use:   "test <name>",
		Short: "Send a test notification to a channel",
		Args:  cobra.ExactArgs(1),
		RunE:  runNotifyTest,
	})

	rootCmd.AddCommand(notifyCmd)

	// jib telegram add/test
	telegramCmd := &cobra.Command{
		Use:   "telegram",
		Short: "Manage Telegram notification channels",
	}
	telegramCmd.AddCommand(&cobra.Command{
		Use:   "add <name>",
		Short: "Add a Telegram notification channel",
		Args:  cobra.ExactArgs(1),
		RunE:  runTelegramAdd,
	})
	telegramCmd.AddCommand(&cobra.Command{
		Use:   "test <name>",
		Short: "Send a test message to a Telegram channel",
		Args:  cobra.ExactArgs(1),
		RunE:  runNotifyTest,
	})
	rootCmd.AddCommand(telegramCmd)

	// jib slack add/test
	slackCmd := &cobra.Command{
		Use:   "slack",
		Short: "Manage Slack notification channels",
	}
	slackCmd.AddCommand(&cobra.Command{
		Use:   "add <name>",
		Short: "Add a Slack notification channel",
		Args:  cobra.ExactArgs(1),
		RunE:  runSlackAdd,
	})
	slackCmd.AddCommand(&cobra.Command{
		Use:   "test <name>",
		Short: "Send a test message to a Slack channel",
		Args:  cobra.ExactArgs(1),
		RunE:  runNotifyTest,
	})
	rootCmd.AddCommand(slackCmd)

	// jib discord add/test
	discordCmd := &cobra.Command{
		Use:   "discord",
		Short: "Manage Discord notification channels",
	}
	discordCmd.AddCommand(&cobra.Command{
		Use:   "add <name>",
		Short: "Add a Discord notification channel",
		Args:  cobra.ExactArgs(1),
		RunE:  runDiscordAdd,
	})
	discordCmd.AddCommand(&cobra.Command{
		Use:   "test <name>",
		Short: "Send a test message to a Discord channel",
		Args:  cobra.ExactArgs(1),
		RunE:  runNotifyTest,
	})
	rootCmd.AddCommand(discordCmd)
}

// runNotifyList shows all configured notification channels and which apps use them.
func runNotifyList(cmd *cobra.Command, args []string) error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}

	if len(cfg.Notifications) == 0 {
		fmt.Println("No notification channels configured.")
		fmt.Println("\nAdd one with:")
		fmt.Println("  jib telegram add <name>")
		fmt.Println("  jib slack add <name>")
		fmt.Println("  jib discord add <name>")
		fmt.Println("  jib notify add <name> --driver webhook --url <url>")
		return nil
	}

	// Build a map of channel name -> apps that use it.
	channelApps := make(map[string][]string)
	for appName, app := range cfg.Apps {
		for _, ch := range app.Notify {
			channelApps[ch] = append(channelApps[ch], appName)
		}
	}

	// Sort channel names for stable output.
	names := make([]string, 0, len(cfg.Notifications))
	for name := range cfg.Notifications {
		names = append(names, name)
	}
	sort.Strings(names)

	// Check for credentials.
	secretsDir := filepath.Join(jibRoot(), "secrets")

	fmt.Printf("%-20s %-10s %-10s %s\n", "NAME", "DRIVER", "CREDS", "APPS")
	fmt.Printf("%-20s %-10s %-10s %s\n", "----", "------", "-----", "----")
	for _, name := range names {
		ch := cfg.Notifications[name]
		credsStatus := "missing"
		if _, err := notify.ReadChannelCreds(secretsDir, name); err == nil {
			credsStatus = "ok"
		}
		apps := channelApps[name]
		sort.Strings(apps)
		appStr := "-"
		if len(apps) > 0 {
			appStr = strings.Join(apps, ", ")
		}
		fmt.Printf("%-20s %-10s %-10s %s\n", name, ch.Driver, credsStatus, appStr)
	}

	return nil
}

// runNotifyAdd adds a generic notification channel.
func runNotifyAdd(cmd *cobra.Command, args []string) error {
	name := args[0]
	driver, _ := cmd.Flags().GetString("driver")
	urlFlag, _ := cmd.Flags().GetString("url")

	if driver == "" {
		return fmt.Errorf("--driver is required (telegram, slack, discord, webhook)")
	}

	if !config.ValidNotifyDrivers[driver] {
		return fmt.Errorf("invalid driver %q; must be telegram, slack, discord, or webhook", driver)
	}

	scanner := bufio.NewScanner(os.Stdin)
	secretsDir := filepath.Join(jibRoot(), "secrets")

	// Telegram needs bot_token + chat_id; handle separately.
	if driver == "telegram" {
		return addTelegramChannel(name, scanner, secretsDir)
	}

	// Slack, discord, and webhook all need a single URL.
	url := urlFlag
	if url == "" {
		promptLabel := strings.ToUpper(driver[:1]) + driver[1:] + " webhook URL: "
		if driver == "webhook" {
			promptLabel = "Webhook URL: "
		}
		fmt.Print(promptLabel)
		if scanner.Scan() {
			url = strings.TrimSpace(scanner.Text())
		}
	}
	if url == "" {
		return fmt.Errorf("webhook URL is required")
	}

	credKey := "webhook_url"
	if driver == "webhook" {
		credKey = "url"
	}
	creds := map[string]string{credKey: url}

	if err := notify.WriteChannelCreds(secretsDir, name, creds); err != nil {
		return err
	}

	if err := addChannelToConfig(name, driver); err != nil {
		return err
	}

	fmt.Printf("Added %s channel %q.\n", driver, name)
	return nil
}

// runNotifyRemove removes a channel from config and deletes its credentials.
func runNotifyRemove(cmd *cobra.Command, args []string) error {
	name := args[0]

	cfgPath := configPath()
	if err := config.ModifyRawConfig(cfgPath, func(raw map[string]interface{}) error {
		removed := false
		if notifRaw, ok := raw["notifications"]; ok {
			if notifMap, ok := notifRaw.(map[string]interface{}); ok {
				if _, exists := notifMap[name]; exists {
					delete(notifMap, name)
					removed = true
					if len(notifMap) == 0 {
						delete(raw, "notifications")
					}
				}
			}
		}

		if !removed {
			return fmt.Errorf("channel %q not found in config", name)
		}

		// Also remove from any app's notify list.
		if appsRaw, ok := raw["apps"]; ok {
			if appsMap, ok := appsRaw.(map[string]interface{}); ok {
				for appName, appRaw := range appsMap {
					if appMap, ok := appRaw.(map[string]interface{}); ok {
						if notifyRaw, ok := appMap["notify"]; ok {
							if notifyList, ok := notifyRaw.([]interface{}); ok {
								var filtered []interface{}
								for _, item := range notifyList {
									if s, ok := item.(string); ok && s != name {
										filtered = append(filtered, item)
									}
								}
								if len(filtered) > 0 {
									appMap["notify"] = filtered
								} else {
									delete(appMap, "notify")
								}
								appsMap[appName] = appMap
							}
						}
					}
				}
			}
		}
		return nil
	}); err != nil {
		return err
	}

	// Delete credentials file.
	secretsDir := filepath.Join(jibRoot(), "secrets")
	if err := notify.DeleteChannelCreds(secretsDir, name); err != nil {
		fmt.Fprintf(os.Stderr, "warning: %v\n", err)
	}

	fmt.Printf("Removed channel %q.\n", name)
	return nil
}

// runNotifyTest sends a test notification to a named channel.
func runNotifyTest(cmd *cobra.Command, args []string) error {
	name := args[0]

	cfg, err := loadConfig()
	if err != nil {
		return err
	}

	ch, ok := cfg.Notifications[name]
	if !ok {
		return fmt.Errorf("channel %q not found in config", name)
	}

	secretsDir := filepath.Join(jibRoot(), "secrets")
	channels := map[string]notify.ChannelConfig{
		name: {Driver: ch.Driver},
	}
	multi := notify.LoadChannels(secretsDir, channels)

	if len(multi.ChannelNames()) == 0 {
		return fmt.Errorf("channel %q has no credentials (check %s/_jib/%s.json)", name, secretsDir, name)
	}

	event := notify.Event{
		Type:      "test",
		Status:    "success",
		Timestamp: time.Now(),
		App:       "jib-test",
	}

	fmt.Printf("Sending test notification to %q (%s)...\n", name, ch.Driver)
	if err := multi.SendToChannel(context.Background(), name, event); err != nil {
		return fmt.Errorf("test failed: %w", err)
	}

	fmt.Println("Test notification sent successfully.")
	return nil
}

// runTelegramAdd prompts for Telegram credentials and adds the channel.
func runTelegramAdd(cmd *cobra.Command, args []string) error {
	name := args[0]
	scanner := bufio.NewScanner(os.Stdin)
	secretsDir := filepath.Join(jibRoot(), "secrets")
	return addTelegramChannel(name, scanner, secretsDir)
}

func addTelegramChannel(name string, scanner *bufio.Scanner, secretsDir string) error {
	fmt.Print("Bot token: ")
	var token string
	if scanner.Scan() {
		token = strings.TrimSpace(scanner.Text())
	}
	if token == "" {
		return fmt.Errorf("bot token is required")
	}

	fmt.Print("Chat ID: ")
	var chatID string
	if scanner.Scan() {
		chatID = strings.TrimSpace(scanner.Text())
	}
	if chatID == "" {
		return fmt.Errorf("chat ID is required")
	}

	creds := map[string]string{"bot_token": token, "chat_id": chatID}
	if err := notify.WriteChannelCreds(secretsDir, name, creds); err != nil {
		return err
	}

	if err := addChannelToConfig(name, "telegram"); err != nil {
		return err
	}

	fmt.Printf("Added telegram channel %q.\n", name)
	return nil
}

// runSlackAdd prompts for Slack webhook URL and adds the channel.
func runSlackAdd(cmd *cobra.Command, args []string) error {
	return addWebhookChannel(args[0], "slack", "Slack webhook URL: ", "webhook_url")
}

// runDiscordAdd prompts for Discord webhook URL and adds the channel.
func runDiscordAdd(cmd *cobra.Command, args []string) error {
	return addWebhookChannel(args[0], "discord", "Discord webhook URL: ", "webhook_url")
}

// addWebhookChannel is a shared helper for drivers that need a single URL credential.
func addWebhookChannel(name, driver, prompt, credKey string) error {
	scanner := bufio.NewScanner(os.Stdin)
	fmt.Print(prompt)
	var url string
	if scanner.Scan() {
		url = strings.TrimSpace(scanner.Text())
	}
	if url == "" {
		return fmt.Errorf("webhook URL is required")
	}

	secretsDir := filepath.Join(jibRoot(), "secrets")
	if err := notify.WriteChannelCreds(secretsDir, name, map[string]string{credKey: url}); err != nil {
		return err
	}
	if err := addChannelToConfig(name, driver); err != nil {
		return err
	}

	fmt.Printf("Added %s channel %q.\n", driver, name)
	return nil
}

// addChannelToConfig writes a notification channel entry to config.yml.
func addChannelToConfig(name, driver string) error {
	cfgPath := configPath()
	if err := config.ModifyRawConfig(cfgPath, func(raw map[string]interface{}) error {
		notifRaw, ok := raw["notifications"]
		if !ok {
			notifRaw = make(map[string]interface{})
			raw["notifications"] = notifRaw
		}
		notifMap, ok := notifRaw.(map[string]interface{})
		if !ok {
			return fmt.Errorf("notifications section in config is not a map")
		}

		if _, exists := notifMap[name]; exists {
			return fmt.Errorf("channel %q already exists in config", name)
		}

		notifMap[name] = map[string]interface{}{
			"driver": driver,
		}
		return nil
	}); err != nil {
		return err
	}

	// Validate.
	if _, err := config.LoadConfig(cfgPath); err != nil {
		fmt.Fprintf(os.Stderr, "warning: config validation failed: %v\n", err)
	}

	return nil
}
