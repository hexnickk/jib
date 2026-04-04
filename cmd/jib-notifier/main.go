// Command jib-notifier sends event notifications to all configured channels.
package main

import (
	"log"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/notify"
	"github.com/hexnickk/jib/internal/notifysvc"
)

func main() {
	configPath := notifysvc.EnvOr("JIB_CONFIG", config.ConfigFile())
	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		log.Fatalf("loading config: %v", err)
	}

	channels := make(map[string]notify.ChannelConfig)
	for name, ch := range cfg.Notifications {
		channels[name] = notify.ChannelConfig{Driver: ch.Driver}
	}

	multi := notify.LoadChannels(channels)
	if len(multi.ChannelNames()) == 0 {
		log.Fatal("no notification channels with valid credentials found")
	}

	notifysvc.Run(multi, cfg)
}
