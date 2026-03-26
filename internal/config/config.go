package config

import (
	"fmt"

	"gopkg.in/yaml.v3"
)

// StringOrSlice handles YAML fields that can be either a single string or a list of strings.
type StringOrSlice []string

func (s *StringOrSlice) UnmarshalYAML(value *yaml.Node) error {
	switch value.Kind {
	case yaml.ScalarNode:
		*s = StringOrSlice{value.Value}
		return nil
	case yaml.SequenceNode:
		var list []string
		if err := value.Decode(&list); err != nil {
			return err
		}
		*s = StringOrSlice(list)
		return nil
	default:
		return fmt.Errorf("expected string or list, got %v", value.Kind)
	}
}

// LatestConfigVersion is the current config schema version.
const LatestConfigVersion = 1

// Config is the top-level Jib configuration.
type Config struct {
	ConfigVersion int                            `yaml:"config_version,omitempty"`
	PollInterval  string                         `yaml:"poll_interval"`
	CertbotEmail  string                         `yaml:"certbot_email"`
	GitHub        *GitHubConfig                  `yaml:"github,omitempty"`
	BackupDests   map[string]BackupDestination   `yaml:"backup_destinations,omitempty"`
	Apps          map[string]App                 `yaml:"apps"`
	Notifications map[string]NotificationChannel `yaml:"notifications,omitempty"`
	Webhook       *WebhookConfig                 `yaml:"webhook,omitempty"`
	Tunnel        *TunnelConfig                  `yaml:"tunnel,omitempty"`
}

// GitHubProvider represents a named authentication provider (deploy key or GitHub App).
type GitHubProvider struct {
	Type  string `yaml:"type"`             // "key" or "app"
	AppID int64  `yaml:"app_id,omitempty"` // only for type=app
}

// GitHubConfig holds GitHub provider settings.
type GitHubConfig struct {
	Providers map[string]GitHubProvider `yaml:"providers,omitempty"`
}

// LookupProvider returns the named provider and whether it exists.
func (cfg *Config) LookupProvider(name string) (GitHubProvider, bool) {
	if cfg.GitHub == nil || cfg.GitHub.Providers == nil {
		return GitHubProvider{}, false
	}
	p, ok := cfg.GitHub.Providers[name]
	return p, ok
}

// BackupDestination defines a remote backup target.
type BackupDestination struct {
	Driver      string `yaml:"driver"`           // r2, s3, ssh, local
	Bucket      string `yaml:"bucket,omitempty"` // for r2/s3
	Host        string `yaml:"host,omitempty"`   // for ssh
	Path        string `yaml:"path,omitempty"`   // for ssh/local
	Retain      int    `yaml:"retain,omitempty"`
	LocalRetain int    `yaml:"local_retain,omitempty"`
	Encrypt     bool   `yaml:"encrypt,omitempty"`
	GPGKeyID    string `yaml:"gpg_key_id,omitempty"`
}

// Resources defines CPU and memory limits for an app's containers.
type Resources struct {
	Memory string `yaml:"memory,omitempty"` // e.g. "256M"
	CPUs   string `yaml:"cpus,omitempty"`   // e.g. "0.5"
}

// AppWebhook stores per-app webhook integration config.
type AppWebhook struct {
	Provider string `yaml:"provider"` // github, gitlab, etc.
}

// App describes a single deployable application.
type App struct {
	Repo         string            `yaml:"repo"`
	Provider     string            `yaml:"provider,omitempty"`
	Branch       string            `yaml:"branch,omitempty"`
	Compose      StringOrSlice     `yaml:"compose,omitempty"`
	Strategy     string            `yaml:"strategy,omitempty"`
	Health       []HealthCheck     `yaml:"health,omitempty"`
	Warmup       string            `yaml:"warmup,omitempty"`
	PreDeploy    []PreDeployHook   `yaml:"pre_deploy,omitempty"`
	BuildArgs    map[string]string `yaml:"build_args,omitempty"`
	Domains      []Domain          `yaml:"domains"`
	NginxInclude string            `yaml:"nginx_include,omitempty"`
	Backup       *BackupConfig     `yaml:"backup,omitempty"`
	SecretsEnv   bool              `yaml:"secrets_env,omitempty"`
	EnvFile      string            `yaml:"env_file,omitempty"`
	Services     []string          `yaml:"services,omitempty"`
	Cron         []CronTask        `yaml:"cron,omitempty"`
	Resources    *Resources        `yaml:"resources,omitempty"`
	Notify       []string          `yaml:"notify,omitempty"`
	Webhook      *AppWebhook       `yaml:"webhook,omitempty"`
}

// Domain maps a hostname to a container port.
type Domain struct {
	Host string `yaml:"host"`
	Port int    `yaml:"port"`
}

// HealthCheck defines an HTTP health endpoint.
type HealthCheck struct {
	Path string `yaml:"path"`
	Port int    `yaml:"port"`
}

// BackupConfig defines per-app backup settings.
type BackupConfig struct {
	Destination  string   `yaml:"destination,omitempty"`  // deprecated single destination
	Destinations []string `yaml:"destinations,omitempty"` // list of destination names
	Schedule     string   `yaml:"schedule,omitempty"`
	Volumes      []string `yaml:"volumes,omitempty"`
	Hook         string   `yaml:"hook,omitempty"`
}

// EffectiveDestinations returns the list of destination names, falling back to the
// singular Destination field for backward compatibility.
func (b *BackupConfig) EffectiveDestinations() []string {
	if len(b.Destinations) > 0 {
		return b.Destinations
	}
	if b.Destination != "" {
		return []string{b.Destination}
	}
	return nil
}

// PreDeployHook names a service to run before the main deploy.
type PreDeployHook struct {
	Service string `yaml:"service"`
}

// CronTask defines a scheduled task for an app.
type CronTask struct {
	Schedule string `yaml:"schedule"`
	Service  string `yaml:"service"`
	Command  string `yaml:"command"`
}

// NotificationChannel defines a named notification channel.
// Credentials (tokens, webhook URLs) are stored in /opt/jib/secrets/_jib/<name>.json.
type NotificationChannel struct {
	Driver string `yaml:"driver"` // telegram, slack, discord, webhook
}

// ValidNotifyDrivers is the set of supported notification drivers.
var ValidNotifyDrivers = map[string]bool{
	"telegram": true,
	"slack":    true,
	"discord":  true,
	"webhook":  true,
}

// WebhookConfig controls the GitHub webhook listener.
type WebhookConfig struct {
	Enabled bool `yaml:"enabled"`
	Port    int  `yaml:"port,omitempty"`
}

// TunnelConfig controls tunnel integration.
type TunnelConfig struct {
	Provider string `yaml:"provider"`
}
