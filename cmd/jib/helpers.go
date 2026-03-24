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

func newNotifier() *notify.Multi {
	return notify.LoadFromSecrets(filepath.Join(jibRoot(), "secrets"))
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
		Notifier:    newNotifier(),
		Proxy:       newProxy(cfg),
		SSL:         newSSLManager(cfg),
		History:     newHistoryLogger(),
		LockDir:     filepath.Join(root, "locks"),
		RepoBaseDir: filepath.Join(root, "repos"),
		OverrideDir: filepath.Join(root, "overrides"),
	}
}

func newCompose(cfg *config.Config, appName string) (*docker.Compose, error) {
	appCfg, ok := cfg.Apps[appName]
	if !ok {
		return nil, fmt.Errorf("app %q not found in config", appName)
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

func currentUser() string {
	user := os.Getenv("USER")
	if user == "" {
		user = "unknown"
	}
	return user
}
