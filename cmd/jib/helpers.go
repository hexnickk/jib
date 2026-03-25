package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/deploy"
	"github.com/hexnickk/jib/internal/docker"
	"github.com/hexnickk/jib/internal/history"
	"github.com/hexnickk/jib/internal/notify"
	"github.com/hexnickk/jib/internal/proxy"
	"github.com/hexnickk/jib/internal/secrets"
	"github.com/hexnickk/jib/internal/ssl"
	"github.com/hexnickk/jib/internal/state"
)

// jibRoot returns the base directory for all jib data.
// Defaults to /opt/jib, overridable with JIB_ROOT env var.
func jibRoot() string {
	if root := os.Getenv("JIB_ROOT"); root != "" {
		return root
	}
	return "/opt/jib"
}

func configPath() string {
	return filepath.Join(jibRoot(), "config.yml")
}

func loadConfig() (*config.Config, error) {
	return config.LoadConfig(configPath())
}

func newStateStore() *state.Store {
	return state.NewStore(filepath.Join(jibRoot(), "state"))
}

func newSecretsManager() *secrets.Manager {
	return secrets.NewManager(filepath.Join(jibRoot(), "secrets"))
}

func newNotifier(cfg *config.Config) *notify.Multi {
	secretsDir := filepath.Join(jibRoot(), "secrets")
	if len(cfg.Notifications) > 0 {
		channels := make(map[string]notify.ChannelConfig, len(cfg.Notifications))
		for name, ch := range cfg.Notifications {
			channels[name] = notify.ChannelConfig{Driver: ch.Driver}
		}
		return notify.LoadChannels(secretsDir, channels)
	}
	// Fallback to legacy loader for configs without named channels.
	return notify.LoadFromSecrets(secretsDir)
}

func newSSLManager(cfg *config.Config) *ssl.CertManager {
	return ssl.NewCertManager(cfg.CertbotEmail, "/var/www/certbot")
}

func newProxy(cfg *config.Config) proxy.Proxy {
	webhookPort := 0
	if cfg.Webhook != nil {
		webhookPort = cfg.Webhook.Port
	}
	return proxy.NewNginx(
		filepath.Join(jibRoot(), "nginx"),
		"/etc/nginx/conf.d",
		webhookPort,
	)
}

func newHistoryLogger() *history.Logger {
	return history.NewLogger(filepath.Join(jibRoot(), "logs"))
}

func newEngine(cfg *config.Config) *deploy.Engine {
	root := jibRoot()
	return &deploy.Engine{
		Config:      cfg,
		StateStore:  newStateStore(),
		Secrets:     newSecretsManager(),
		Notifier:    newNotifier(cfg),
		Proxy:       newProxy(cfg),
		SSL:         newSSLManager(cfg),
		History:     newHistoryLogger(),
		LockDir:     filepath.Join(root, "locks"),
		RepoBaseDir: filepath.Join(root, "repos"),
		OverrideDir: filepath.Join(root, "overrides"),
	}
}

func newCompose(cfg *config.Config, appName string) (*docker.Compose, error) {
	appCfg, err := requireApp(cfg, appName)
	if err != nil {
		return nil, err
	}

	root := jibRoot()
	files := []string(appCfg.Compose)
	if len(files) == 0 {
		files = []string{"docker-compose.yml"}
	}

	envFile := ""
	if appCfg.SecretsEnv {
		mgr := newSecretsManager()
		envFile = mgr.SymlinkPath(appName, appCfg.EnvFile)
	}

	repoDir := filepath.Join(root, "repos", appName)

	return &docker.Compose{
		App:      appName,
		Dir:      repoDir,
		Files:    files,
		EnvFile:  envFile,
		Override: docker.OverridePath(filepath.Join(root, "overrides"), appName),
	}, nil
}

// requireApp looks up an app in the config and returns it, or returns an error
// with a helpful message if it doesn't exist.
func requireApp(cfg *config.Config, appName string) (config.App, error) {
	appCfg, ok := cfg.Apps[appName]
	if !ok {
		return config.App{}, fmt.Errorf("app %q not found in config (see 'jib apps' for available apps)", appName)
	}
	return appCfg, nil
}

func currentUser() string {
	user := os.Getenv("USER")
	if user == "" {
		user = "unknown"
	}
	return user
}
