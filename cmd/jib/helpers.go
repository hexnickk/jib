package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/deploy"
	"github.com/hexnickk/jib/internal/docker"
	"github.com/hexnickk/jib/internal/notify"
	"github.com/hexnickk/jib/internal/proxy"
	"github.com/hexnickk/jib/internal/secrets"
	"github.com/hexnickk/jib/internal/ssl"
	"github.com/hexnickk/jib/internal/state"
)

const (
	defaultRepoBaseDir  = "/opt/jib/repos"
	defaultNginxDir     = "/opt/jib/nginx"
	defaultSymlinkDir   = "/etc/nginx/conf.d"
	defaultOverrideDir  = "/opt/jib/overrides"
)

func loadConfig() (*config.Config, error) {
	return config.LoadConfig(config.DefaultConfigPath())
}

func newStateStore() *state.Store {
	return state.NewStore(state.DefaultStateDir())
}

func newSecretsManager() *secrets.Manager {
	return secrets.NewManager(secrets.DefaultSecretsDir)
}

func newNotifier() *notify.Multi {
	return notify.LoadFromSecrets(secrets.DefaultSecretsDir)
}

func newSSLManager(cfg *config.Config) *ssl.CertManager {
	return ssl.NewCertManager(cfg.CertbotEmail, "/var/www/certbot")
}

func newProxy(cfg *config.Config) proxy.Proxy {
	webhookPort := 0
	if cfg.Webhook != nil {
		webhookPort = cfg.Webhook.Port
	}
	return proxy.NewNginx(defaultNginxDir, defaultSymlinkDir, webhookPort)
}

func newEngine(cfg *config.Config) *deploy.Engine {
	return &deploy.Engine{
		Config:      cfg,
		StateStore:  newStateStore(),
		Secrets:     newSecretsManager(),
		Notifier:    newNotifier(),
		Proxy:       newProxy(cfg),
		SSL:         newSSLManager(cfg),
		LockDir:     state.DefaultLockDir(),
		RepoBaseDir: defaultRepoBaseDir,
		OverrideDir: defaultOverrideDir,
	}
}

func newCompose(cfg *config.Config, appName string) (*docker.Compose, error) {
	appCfg, ok := cfg.Apps[appName]
	if !ok {
		return nil, fmt.Errorf("app %q not found in config", appName)
	}

	files := []string(appCfg.Compose)
	if len(files) == 0 {
		files = []string{"docker-compose.yml"}
	}

	envFile := ""
	if appCfg.SecretsEnv {
		mgr := newSecretsManager()
		envFile = mgr.SymlinkPath(appName, appCfg.EnvFile)
	}

	repoDir := filepath.Join(defaultRepoBaseDir, appName)

	return &docker.Compose{
		App:      appName,
		Dir:      repoDir,
		Files:    files,
		EnvFile:  envFile,
		Override: docker.OverridePath(defaultOverrideDir, appName),
	}, nil
}

func currentUser() string {
	user := os.Getenv("USER")
	if user == "" {
		user = "unknown"
	}
	return user
}
