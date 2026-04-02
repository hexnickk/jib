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
const LatestConfigVersion = 3

// Config is the top-level Jib configuration.
type Config struct {
	ConfigVersion int                            `yaml:"config_version,omitempty"`
	PollInterval  string                         `yaml:"poll_interval"`
	GitHub        *GitHubConfig                  `yaml:"github,omitempty"`
	Apps          map[string]App                 `yaml:"apps"`
	Notifications map[string]NotificationChannel `yaml:"notifications,omitempty"`
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

// ValidIngressValues contains the allowed ingress types.
var ValidIngressValues = map[string]bool{"": true, "direct": true, "cloudflare-tunnel": true}

// IsTunnelIngress returns true if the domain uses tunnel-based ingress (Cloudflare)
// where TLS is handled at the edge, not by the server.
func (d *Domain) IsTunnelIngress() bool {
	return d.Ingress == "cloudflare-tunnel"
}

// App describes a single deployable application.
type App struct {
	Repo      string            `yaml:"repo"`
	Provider  string            `yaml:"provider,omitempty"`
	Ingress   string            `yaml:"ingress,omitempty"` // deprecated v1 field; migrated to per-domain, then cleared
	Branch    string            `yaml:"branch,omitempty"`
	Compose   StringOrSlice     `yaml:"compose,omitempty"`
	Health    []HealthCheck     `yaml:"health,omitempty"`
	Warmup    string            `yaml:"warmup,omitempty"`
	PreDeploy []PreDeployHook   `yaml:"pre_deploy,omitempty"`
	BuildArgs map[string]string `yaml:"build_args,omitempty"`
	Domains   []Domain          `yaml:"domains"`
	EnvFile   string            `yaml:"env_file,omitempty"` // defaults to ".env"; secrets loaded if file exists
	Services  []string          `yaml:"services,omitempty"`
	Notify    []string          `yaml:"notify,omitempty"`
}

// Domain maps a hostname to a container port with optional ingress method.
type Domain struct {
	Host    string `yaml:"host"`
	Port    int    `yaml:"port"`
	Ingress string `yaml:"ingress,omitempty"` // "", "direct", "cloudflare-tunnel"
}

// HealthCheck defines an HTTP health endpoint.
type HealthCheck struct {
	Path string `yaml:"path"`
	Port int    `yaml:"port"`
}

// PreDeployHook names a service to run before the main deploy.
type PreDeployHook struct {
	Service string `yaml:"service"`
}

// NotificationChannel defines a named notification channel.
// Credentials (tokens, webhook URLs) are stored in /opt/jib/secrets/_jib/<name>.json.
type NotificationChannel struct {
	Driver string `yaml:"driver"` // telegram
}

// ValidNotifyDrivers is the set of supported notification drivers.
var ValidNotifyDrivers = map[string]bool{
	"telegram": true,
}

// TunnelConfig controls tunnel integration.
type TunnelConfig struct {
	Provider  string `yaml:"provider"`
	TunnelID  string `yaml:"tunnel_id,omitempty"`
	AccountID string `yaml:"account_id,omitempty"`
}
