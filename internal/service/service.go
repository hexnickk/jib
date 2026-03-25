package service

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Supported service types and their default ports.
var serviceTypes = map[string]serviceTemplate{
	"postgres": {
		Image:       "postgres",
		DefaultTag:  "16-alpine",
		DefaultPort: 5432,
		EnvVars: func(name, password string) map[string]string {
			return map[string]string{
				"POSTGRES_USER":     "jib",
				"POSTGRES_PASSWORD": password,
				"POSTGRES_DB":       name,
			}
		},
		HealthCmd:    []string{"pg_isready", "-U", "jib"},
		ConnString:   func(name, password string, port int) string { return fmt.Sprintf("postgres://jib:%s@%s:%d/%s", password, name, port, name) },
		HasAuth:      true,
		CredentialFn: defaultCredentials,
	},
	"mysql": {
		Image:       "mysql",
		DefaultTag:  "8-oracle",
		DefaultPort: 3306,
		EnvVars: func(name, password string) map[string]string {
			return map[string]string{
				"MYSQL_ROOT_PASSWORD": password,
				"MYSQL_USER":         "jib",
				"MYSQL_PASSWORD":     password,
				"MYSQL_DATABASE":     name,
			}
		},
		HealthCmd:    []string{"mysqladmin", "ping", "-h", "localhost", "-ujib", "-p__PASSWORD__"},
		ConnString:   func(name, password string, port int) string { return fmt.Sprintf("mysql://jib:%s@%s:%d/%s", password, name, port, name) },
		HasAuth:      true,
		CredentialFn: defaultCredentials,
	},
	"mariadb": {
		Image:       "mariadb",
		DefaultTag:  "11",
		DefaultPort: 3306,
		EnvVars: func(name, password string) map[string]string {
			return map[string]string{
				"MARIADB_ROOT_PASSWORD": password,
				"MARIADB_USER":         "jib",
				"MARIADB_PASSWORD":     password,
				"MARIADB_DATABASE":     name,
			}
		},
		HealthCmd:    []string{"healthcheck.sh", "--connect", "--innodb_initialized"},
		ConnString:   func(name, password string, port int) string { return fmt.Sprintf("mysql://jib:%s@%s:%d/%s", password, name, port, name) },
		HasAuth:      true,
		CredentialFn: defaultCredentials,
	},
	"redis": {
		Image:       "redis",
		DefaultTag:  "7-alpine",
		DefaultPort: 6379,
		EnvVars:     func(name, password string) map[string]string { return nil },
		HealthCmd:   []string{"redis-cli", "ping"},
		ConnString: func(name, _ string, port int) string {
			return fmt.Sprintf("redis://%s:%d", name, port)
		},
		HasAuth:      false,
		CredentialFn: redisCredentials,
	},
	"mongodb": {
		Image:       "mongo",
		DefaultTag:  "7",
		DefaultPort: 27017,
		EnvVars: func(name, password string) map[string]string {
			return map[string]string{
				"MONGO_INITDB_ROOT_USERNAME": "jib",
				"MONGO_INITDB_ROOT_PASSWORD": password,
				"MONGO_INITDB_DATABASE":      name,
			}
		},
		HealthCmd: []string{"mongosh", "--eval", "db.adminCommand('ping')", "--quiet"},
		ConnString: func(name, password string, port int) string {
			return fmt.Sprintf("mongodb://jib:%s@%s:%d/%s?authSource=admin", password, name, port, name)
		},
		HasAuth:      true,
		CredentialFn: mongoCredentials,
	},
}

type serviceTemplate struct {
	Image        string
	DefaultTag   string
	DefaultPort  int
	EnvVars      func(name, password string) map[string]string
	HealthCmd    []string
	ConnString   func(name, password string, port int) string
	HasAuth      bool
	CredentialFn func(name, password string, port int) map[string]string
}

func defaultCredentials(name, password string, port int) map[string]string {
	return map[string]string{
		"DB_USER":     "jib",
		"DB_PASSWORD": password,
		"DB_NAME":     name,
		"DB_HOST":     name,
		"DB_PORT":     fmt.Sprintf("%d", port),
	}
}

func redisCredentials(name, _ string, port int) map[string]string {
	return map[string]string{
		"DB_HOST": name,
		"DB_PORT": fmt.Sprintf("%d", port),
	}
}

// mongoCredentials is an alias; MongoDB uses the same credential keys as the default.
var mongoCredentials = defaultCredentials

// ServiceInfo holds info about a shared service.
type ServiceInfo struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Version    string `json:"version"`
	Status     string `json:"status"`
	Port       int    `json:"port"`
	ConnString string `json:"connection_string,omitempty"`
	Health     string `json:"health,omitempty"`
	Uptime     string `json:"uptime,omitempty"`
}

// Manager manages shared services.
type Manager struct {
	ServicesDir string // /opt/jib/services
	SecretsDir  string // /opt/jib/secrets/_services
}

// NewManager creates a new service Manager.
func NewManager(root string) *Manager {
	return &Manager{
		ServicesDir: filepath.Join(root, "services"),
		SecretsDir:  filepath.Join(root, "secrets", "_services"),
	}
}

// SupportedTypes returns the list of supported service type names.
func SupportedTypes() []string {
	types := make([]string, 0, len(serviceTypes))
	for t := range serviceTypes {
		types = append(types, t)
	}
	sort.Strings(types)
	return types
}

// IsSupported returns true if the given type is supported.
func IsSupported(serviceType string) bool {
	_, ok := serviceTypes[serviceType]
	return ok
}

// Add creates and starts a new shared service.
func (m *Manager) Add(name, serviceType, version string) (*ServiceInfo, error) {
	tmpl, ok := serviceTypes[serviceType]
	if !ok {
		return nil, fmt.Errorf("unsupported service type %q; supported: %s", serviceType, strings.Join(SupportedTypes(), ", "))
	}

	tag := version
	if tag == "" {
		tag = tmpl.DefaultTag
	}

	// Check if service already exists
	svcDir := filepath.Join(m.ServicesDir, name)
	if _, err := os.Stat(filepath.Join(svcDir, "docker-compose.yml")); err == nil {
		return nil, fmt.Errorf("service %q already exists at %s", name, svcDir)
	}

	// Generate credentials
	password := ""
	if tmpl.HasAuth {
		var err error
		password, err = generatePassword(32)
		if err != nil {
			return nil, fmt.Errorf("generating password: %w", err)
		}
	}

	// Store credentials
	if err := m.storeCredentials(name, tmpl, password); err != nil {
		return nil, fmt.Errorf("storing credentials: %w", err)
	}

	// Generate docker-compose.yml
	if err := m.generateCompose(name, serviceType, tmpl, tag, password); err != nil {
		return nil, fmt.Errorf("generating compose file: %w", err)
	}

	// Ensure jib-shared network exists
	if err := ensureSharedNetwork(); err != nil {
		return nil, fmt.Errorf("creating jib-shared network: %w", err)
	}

	// Start the service
	if err := m.composeUp(name); err != nil {
		return nil, fmt.Errorf("starting service: %w", err)
	}

	connStr := tmpl.ConnString(name, password, tmpl.DefaultPort)

	return &ServiceInfo{
		Name:       name,
		Type:       serviceType,
		Version:    tag,
		Port:       tmpl.DefaultPort,
		ConnString: connStr,
		Status:     "starting",
	}, nil
}

// Remove stops and removes a shared service.
func (m *Manager) Remove(name string, removeVolumes bool) error {
	svcDir := filepath.Join(m.ServicesDir, name)
	if _, err := os.Stat(filepath.Join(svcDir, "docker-compose.yml")); os.IsNotExist(err) {
		return fmt.Errorf("service %q not found", name)
	}

	// Stop and remove containers
	if err := m.composeDown(name, removeVolumes); err != nil {
		return fmt.Errorf("stopping service: %w", err)
	}

	// Remove compose directory
	if err := os.RemoveAll(svcDir); err != nil {
		return fmt.Errorf("removing service directory: %w", err)
	}

	// Remove secrets
	secretFile := filepath.Join(m.SecretsDir, name+".env")
	_ = os.Remove(secretFile)

	return nil
}

// List returns info about all shared services.
func (m *Manager) List() ([]ServiceInfo, error) {
	entries, err := os.ReadDir(m.ServicesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading services directory: %w", err)
	}

	var services []ServiceInfo
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		composePath := filepath.Join(m.ServicesDir, name, "docker-compose.yml")
		if _, statErr := os.Stat(composePath); statErr != nil {
			continue
		}

		info, err := m.getServiceInfo(name)
		if err != nil {
			// Still include it with unknown status
			services = append(services, ServiceInfo{Name: name, Status: "unknown"})
			continue
		}
		services = append(services, *info)
	}

	return services, nil
}

// Status returns detailed info for a single service.
func (m *Manager) Status(name string) (*ServiceInfo, error) {
	svcDir := filepath.Join(m.ServicesDir, name)
	if _, err := os.Stat(filepath.Join(svcDir, "docker-compose.yml")); os.IsNotExist(err) {
		return nil, fmt.Errorf("service %q not found", name)
	}

	info, err := m.getServiceInfo(name)
	if err != nil {
		return nil, err
	}

	// Add connection string from secrets
	creds, err := m.loadCredentials(name)
	if err == nil {
		svcType := info.Type
		if tmpl, ok := serviceTypes[svcType]; ok {
			password := creds["DB_PASSWORD"]
			info.ConnString = tmpl.ConnString(name, password, info.Port)
		}
	}

	return info, nil
}

// getServiceInfo reads the compose file and gets container status.
func (m *Manager) getServiceInfo(name string) (*ServiceInfo, error) {
	composePath := filepath.Join(m.ServicesDir, name, "docker-compose.yml")
	data, err := os.ReadFile(composePath)
	if err != nil {
		return nil, fmt.Errorf("reading compose file: %w", err)
	}

	// Parse compose file to get image/type info
	var compose struct {
		Services map[string]struct {
			Image  string `yaml:"image"`
			Labels map[string]string `yaml:"labels"`
		} `yaml:"services"`
	}
	if err := yaml.Unmarshal(data, &compose); err != nil {
		return nil, fmt.Errorf("parsing compose file: %w", err)
	}

	info := &ServiceInfo{Name: name}

	for _, svc := range compose.Services {
		// Parse image:tag
		parts := strings.SplitN(svc.Image, ":", 2)
		imageName := parts[0]
		tag := ""
		if len(parts) == 2 {
			tag = parts[1]
		}

		// Get type from labels or image name
		if svcType, ok := svc.Labels["jib.service.type"]; ok {
			info.Type = svcType
		} else {
			// Infer from image name
			for typeName, tmpl := range serviceTypes {
				if tmpl.Image == imageName {
					info.Type = typeName
					break
				}
			}
		}
		info.Version = tag

		if tmpl, ok := serviceTypes[info.Type]; ok {
			info.Port = tmpl.DefaultPort
		}
		break // only one service per compose
	}

	// Get container status
	status, health, uptime := m.containerStatus(name)
	info.Status = status
	info.Health = health
	info.Uptime = uptime

	return info, nil
}

// containerStatus checks the docker container status for a service.
func (m *Manager) containerStatus(name string) (status, health, uptime string) {
	svcDir := filepath.Join(m.ServicesDir, name)

	// Use docker compose ps to check status
	cmd := exec.Command("docker", "compose", "-p", "jib-svc-"+name, "-f", "docker-compose.yml", "ps", "--format", "{{.State}}|{{.Health}}|{{.RunningFor}}")
	cmd.Dir = svcDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		// Try simpler format
		cmd2 := exec.Command("docker", "compose", "-p", "jib-svc-"+name, "-f", "docker-compose.yml", "ps", "--format", "{{.State}}")
		cmd2.Dir = svcDir
		out2, err2 := cmd2.CombinedOutput()
		if err2 != nil {
			return "stopped", "", ""
		}
		state := strings.TrimSpace(string(out2))
		if state == "" {
			return "stopped", "", ""
		}
		return state, "", ""
	}

	line := strings.TrimSpace(string(out))
	if line == "" {
		return "stopped", "", ""
	}

	// Parse first line only
	lines := strings.Split(line, "\n")
	parts := strings.SplitN(lines[0], "|", 3)
	status = strings.TrimSpace(parts[0])
	if len(parts) > 1 {
		health = strings.TrimSpace(parts[1])
	}
	if len(parts) > 2 {
		uptime = strings.TrimSpace(parts[2])
	}

	return status, health, uptime
}

// loadCredentials reads the credentials file for a service.
func (m *Manager) loadCredentials(name string) (map[string]string, error) {
	secretFile := filepath.Join(m.SecretsDir, name+".env")
	data, err := os.ReadFile(secretFile)
	if err != nil {
		return nil, err
	}

	creds := make(map[string]string)
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if idx := strings.Index(line, "="); idx > 0 {
			creds[line[:idx]] = line[idx+1:]
		}
	}
	return creds, nil
}

// storeCredentials writes the credentials file for a service.
func (m *Manager) storeCredentials(name string, tmpl serviceTemplate, password string) error {
	if err := os.MkdirAll(m.SecretsDir, 0700); err != nil {
		return fmt.Errorf("creating secrets directory: %w", err)
	}

	creds := tmpl.CredentialFn(name, password, tmpl.DefaultPort)
	if len(creds) == 0 {
		return nil
	}

	var lines []string
	// Write in a deterministic order
	keyOrder := []string{"DB_USER", "DB_PASSWORD", "DB_NAME", "DB_HOST", "DB_PORT"}
	for _, key := range keyOrder {
		if val, ok := creds[key]; ok {
			lines = append(lines, key+"="+val)
		}
	}

	content := strings.Join(lines, "\n") + "\n"
	secretFile := filepath.Join(m.SecretsDir, name+".env")
	if err := os.WriteFile(secretFile, []byte(content), 0600); err != nil {
		return fmt.Errorf("writing credentials: %w", err)
	}
	return nil
}

// composeFile represents the generated docker-compose.yml for a service.
type composeFile struct {
	Services map[string]composeService `yaml:"services"`
	Volumes  map[string]interface{}    `yaml:"volumes"`
	Networks map[string]composeNetwork `yaml:"networks"`
}

type composeService struct {
	Image       string            `yaml:"image"`
	ContainerName string          `yaml:"container_name"`
	Restart     string            `yaml:"restart"`
	Environment map[string]string `yaml:"environment,omitempty"`
	Command     []string          `yaml:"command,omitempty"`
	Volumes     []string          `yaml:"volumes"`
	Ports       []string          `yaml:"ports,omitempty"`
	Networks    []string          `yaml:"networks"`
	Labels      map[string]string `yaml:"labels"`
	Healthcheck *healthcheck      `yaml:"healthcheck"`
	Logging     *loggingConfig    `yaml:"logging"`
}

type healthcheck struct {
	Test     []string `yaml:"test"`
	Interval string   `yaml:"interval"`
	Timeout  string   `yaml:"timeout"`
	Retries  int      `yaml:"retries"`
}

type loggingConfig struct {
	Driver  string            `yaml:"driver"`
	Options map[string]string `yaml:"options"`
}

type composeNetwork struct {
	External bool `yaml:"external"`
}

func (m *Manager) generateCompose(name, serviceType string, tmpl serviceTemplate, tag, password string) error {
	svcDir := filepath.Join(m.ServicesDir, name)
	if err := os.MkdirAll(svcDir, 0755); err != nil {
		return fmt.Errorf("creating service directory: %w", err)
	}

	volumeName := fmt.Sprintf("jib-service-%s_data", name)

	// Build health check test command
	healthTest := make([]string, 0, len(tmpl.HealthCmd)+1)
	healthTest = append(healthTest, "CMD-SHELL")
	// Join the health cmd as a shell command
	healthCmdStr := strings.Join(tmpl.HealthCmd, " ")
	// Replace password placeholder if needed
	healthCmdStr = strings.ReplaceAll(healthCmdStr, "__PASSWORD__", password)
	healthTest = append(healthTest, healthCmdStr)

	// Build environment
	envVars := tmpl.EnvVars(name, password)

	svc := composeService{
		Image:         fmt.Sprintf("%s:%s", tmpl.Image, tag),
		ContainerName: name,
		Restart:       "unless-stopped",
		Environment:   envVars,
		Volumes:       []string{fmt.Sprintf("%s:%s", volumeName, containerDataPath(serviceType))},
		Networks:      []string{"jib-shared"},
		Labels: map[string]string{
			"jib.managed":      "true",
			"jib.service":      name,
			"jib.service.type": serviceType,
		},
		Healthcheck: &healthcheck{
			Test:     healthTest,
			Interval: "10s",
			Timeout:  "5s",
			Retries:  5,
		},
		Logging: &loggingConfig{
			Driver: "json-file",
			Options: map[string]string{
				"max-size": "50m",
				"max-file": "3",
			},
		},
	}

	compose := composeFile{
		Services: map[string]composeService{
			name: svc,
		},
		Volumes: map[string]interface{}{
			volumeName: nil,
		},
		Networks: map[string]composeNetwork{
			"jib-shared": {External: true},
		},
	}

	data, err := yaml.Marshal(compose)
	if err != nil {
		return fmt.Errorf("marshaling compose: %w", err)
	}

	header := []byte("# Auto-generated by jib — do not edit\n")
	composePath := filepath.Join(svcDir, "docker-compose.yml")
	if err := os.WriteFile(composePath, append(header, data...), 0644); err != nil {
		return fmt.Errorf("writing compose file: %w", err)
	}

	// Also write a .type file for easy type detection without parsing YAML
	typeFile := filepath.Join(svcDir, ".type")
	_ = os.WriteFile(typeFile, []byte(serviceType+"\n"), 0644)

	return nil
}

// containerDataPath returns the absolute data directory path inside the container for each service type.
func containerDataPath(serviceType string) string {
	switch serviceType {
	case "postgres":
		return "/var/lib/postgresql/data"
	case "mysql", "mariadb":
		return "/var/lib/mysql"
	case "redis":
		return "/data"
	case "mongodb":
		return "/data/db"
	default:
		return "/data"
	}
}

func (m *Manager) composeUp(name string) error {
	svcDir := filepath.Join(m.ServicesDir, name)
	cmd := exec.Command("docker", "compose", "-p", "jib-svc-"+name, "-f", "docker-compose.yml", "up", "-d")
	cmd.Dir = svcDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func (m *Manager) composeDown(name string, volumes bool) error {
	svcDir := filepath.Join(m.ServicesDir, name)
	args := []string{"compose", "-p", "jib-svc-" + name, "-f", "docker-compose.yml", "down"}
	if volumes {
		args = append(args, "-v")
	}
	cmd := exec.Command("docker", args...)
	cmd.Dir = svcDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// ensureSharedNetwork creates the jib-shared Docker network if it doesn't exist.
func ensureSharedNetwork() error {
	// Check if network exists
	cmd := exec.Command("docker", "network", "inspect", "jib-shared")
	if err := cmd.Run(); err == nil {
		return nil // already exists
	}

	// Create it
	cmd = exec.Command("docker", "network", "create", "jib-shared")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("docker network create jib-shared: %s: %w", strings.TrimSpace(string(out)), err)
	}
	return nil
}

// generatePassword generates a random hex password of the given length in bytes.
func generatePassword(byteLen int) (string, error) {
	b := make([]byte, byteLen)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// WaitHealthy waits up to the given duration for the service to become healthy.
func (m *Manager) WaitHealthy(name string, timeout time.Duration) error {
	svcDir := filepath.Join(m.ServicesDir, name)
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		cmd := exec.Command("docker", "compose", "-p", "jib-svc-"+name, "-f", "docker-compose.yml", "ps", "--format", "{{.Health}}")
		cmd.Dir = svcDir
		out, err := cmd.CombinedOutput()
		if err == nil {
			health := strings.TrimSpace(string(out))
			if health == "healthy" {
				return nil
			}
		}
		time.Sleep(2 * time.Second)
	}

	return fmt.Errorf("service %q did not become healthy within %s", name, timeout)
}
