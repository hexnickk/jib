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
	ConfigVersion    int                          `yaml:"config_version,omitempty"`
	PollInterval     string                       `yaml:"poll_interval"`
	CertbotEmail     string                       `yaml:"certbot_email"`
	GitHub           *GitHubConfig                `yaml:"github,omitempty"`
	BackupDests      map[string]BackupDestination `yaml:"backup_destinations,omitempty"`
	Apps             map[string]App               `yaml:"apps"`
	Notifications    *NotificationConfig          `yaml:"notifications,omitempty"`
	Webhook          *WebhookConfig               `yaml:"webhook,omitempty"`
	Tunnel           *TunnelConfig                `yaml:"tunnel,omitempty"`
}

// GitHubConfig holds GitHub App settings.
type GitHubConfig struct {
	AppID int64 `yaml:"app_id"`
}

// BackupDestination defines a remote backup target.
type BackupDestination struct {
	Driver      string `yaml:"driver"`
	Bucket      string `yaml:"bucket"`
	Retain      int    `yaml:"retain,omitempty"`
	LocalRetain int    `yaml:"local_retain,omitempty"`
	Encrypt     bool   `yaml:"encrypt,omitempty"`
	GPGKeyID    string `yaml:"gpg_key_id,omitempty"`
}

// App describes a single deployable application.
type App struct {
	Repo         string            `yaml:"repo"`
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
	Destination string   `yaml:"destination"`
	Schedule    string   `yaml:"schedule"`
	Volumes     []string `yaml:"volumes,omitempty"`
	Hook        string   `yaml:"hook,omitempty"`
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

// NotificationConfig holds notification channel markers.
// Actual secrets (tokens, webhook URLs) live in /opt/jib/secrets/_jib/.
type NotificationConfig struct {
	Telegram *struct{} `yaml:"telegram,omitempty"`
	Slack    *struct{} `yaml:"slack,omitempty"`
	Discord  *struct{} `yaml:"discord,omitempty"`
	Webhook  *struct{} `yaml:"webhook,omitempty"`
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
