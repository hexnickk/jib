package docker

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// ComposeService represents a service from a docker-compose.yml (only fields we need).
type ComposeService struct {
	Name       string
	HostPort   int    // First host-mapped port, 0 if none
	Domain     string // From jib.domain label, if set
	Ingress    string // From jib.ingress label, if set
	HealthPath string // Parsed from healthcheck.test if it's a curl/wget URL
	HealthPort int    // Parsed from healthcheck.test
}

// composeFile is a minimal representation of docker-compose.yml.
type composeFile struct {
	Services map[string]composeServiceDef `yaml:"services"`
}

type composeServiceDef struct {
	Ports       []interface{} `yaml:"ports"`
	Labels      composeLabels `yaml:"labels,omitempty"`
	Healthcheck *struct {
		Test interface{} `yaml:"test"`
	} `yaml:"healthcheck,omitempty"`
}

// composeLabels handles both map and list forms of docker-compose labels.
type composeLabels map[string]string

func (cl *composeLabels) UnmarshalYAML(value *yaml.Node) error {
	*cl = make(map[string]string)
	switch value.Kind {
	case yaml.MappingNode:
		var m map[string]string
		if err := value.Decode(&m); err != nil {
			return err
		}
		*cl = m
	case yaml.SequenceNode:
		var items []string
		if err := value.Decode(&items); err != nil {
			return err
		}
		for _, item := range items {
			if k, v, ok := strings.Cut(item, "="); ok {
				(*cl)[k] = v
			}
		}
	}
	return nil
}

// ParseComposeServices reads a compose file and extracts port/health info per service.
func ParseComposeServices(repoDir string, composeFiles []string) ([]ComposeService, error) {
	if len(composeFiles) == 0 {
		composeFiles = []string{"docker-compose.yml"}
	}

	// Merge services from all compose files (later files override)
	merged := make(map[string]composeServiceDef)
	for _, f := range composeFiles {
		path := filepath.Join(repoDir, f)
		data, err := os.ReadFile(path) //nolint:gosec // path from trusted compose file list
		if err != nil {
			return nil, fmt.Errorf("reading %s: %w", f, err)
		}

		var cf composeFile
		if err := yaml.Unmarshal(data, &cf); err != nil {
			return nil, fmt.Errorf("parsing %s: %w", f, err)
		}

		for name, svc := range cf.Services {
			if existing, ok := merged[name]; ok {
				// Merge: later file wins for non-empty fields
				if len(svc.Ports) > 0 {
					existing.Ports = svc.Ports
				}
				if len(svc.Labels) > 0 {
					existing.Labels = svc.Labels
				}
				if svc.Healthcheck != nil {
					existing.Healthcheck = svc.Healthcheck
				}
				merged[name] = existing
			} else {
				merged[name] = svc
			}
		}
	}

	var services []ComposeService
	for name, svc := range merged {
		cs := ComposeService{Name: name}

		// Parse first host port
		if len(svc.Ports) > 0 {
			cs.HostPort = parseFirstHostPort(svc.Ports[0])
		}

		// Parse jib labels
		if d, ok := svc.Labels["jib.domain"]; ok {
			cs.Domain = d
		}
		if ing, ok := svc.Labels["jib.ingress"]; ok {
			cs.Ingress = ing
		}

		// Parse health check from healthcheck.test
		if svc.Healthcheck != nil && svc.Healthcheck.Test != nil {
			cs.HealthPath, cs.HealthPort = parseHealthcheck(svc.Healthcheck.Test)
		}

		services = append(services, cs)
	}

	return services, nil
}

// InferHealthAndPort returns the best-guess health path and host-mapped port from compose services.
// Returns path, port. Defaults to "/health" if no healthcheck found.
// Always returns the host-mapped port (not the container-internal port) since jib
// health checks run from the host via localhost:<host-port>.
func InferHealthAndPort(services []ComposeService) (string, int) {
	// Prefer a service that has both a healthcheck and a host-mapped port
	for _, svc := range services {
		if svc.HealthPath != "" && svc.HostPort > 0 {
			return svc.HealthPath, svc.HostPort
		}
	}

	// Fall back to first service with a host port, default /health
	for _, svc := range services {
		if svc.HostPort > 0 {
			return "/health", svc.HostPort
		}
	}

	return "/health", 0
}

// InferPorts returns all host-mapped ports from compose services.
func InferPorts(services []ComposeService) []int {
	var ports []int
	for _, svc := range services {
		if svc.HostPort > 0 {
			ports = append(ports, svc.HostPort)
		}
	}
	return ports
}

// ServiceByName returns the ComposeService with the given name, or false if not found.
func ServiceByName(services []ComposeService, name string) (ComposeService, bool) {
	for _, svc := range services {
		if svc.Name == name {
			return svc, true
		}
	}
	return ComposeService{}, false
}

// ServicesWithDomainLabels returns services that have a jib.domain label set.
func ServicesWithDomainLabels(services []ComposeService) []ComposeService {
	var out []ComposeService
	for _, svc := range services {
		if svc.Domain != "" {
			out = append(out, svc)
		}
	}
	return out
}

// parseFirstHostPort extracts the host port from a port mapping.
// Handles: "3000:3000", "8080:80", 3000, "3000", {"published": 3000, "target": 3000}
func parseFirstHostPort(p interface{}) int {
	switch v := p.(type) {
	case string:
		// "host:container" or "host:container/proto" or just "port"
		v = strings.Split(v, "/")[0] // strip /tcp /udp
		if strings.Contains(v, ":") {
			parts := strings.Split(v, ":")
			// Could be "ip:host:container" or "host:container"
			hostPart := parts[0]
			if len(parts) == 3 {
				hostPart = parts[1]
			}
			port, _ := strconv.Atoi(hostPart)
			return port
		}
		port, _ := strconv.Atoi(v)
		return port
	case int:
		return v
	case float64:
		return int(v)
	case map[string]interface{}:
		if pub, ok := v["published"]; ok {
			switch pv := pub.(type) {
			case int:
				return pv
			case float64:
				return int(pv)
			case string:
				port, _ := strconv.Atoi(pv)
				return port
			}
		}
	}
	return 0
}

// parseHealthcheck extracts path and port from a healthcheck test command.
// Handles: ["CMD", "curl", "-f", "http://localhost:3000/health"]
//
//	["CMD-SHELL", "curl -f http://localhost:3000/health"]
//	"curl -f http://localhost:3000/health"
func parseHealthcheck(test interface{}) (string, int) {
	var cmdStr string

	switch v := test.(type) {
	case string:
		cmdStr = v
	case []interface{}:
		// Join all parts after CMD/CMD-SHELL
		var parts []string
		for _, item := range v {
			if s, ok := item.(string); ok {
				parts = append(parts, s)
			}
		}
		cmdStr = strings.Join(parts, " ")
	default:
		return "", 0
	}

	// Look for http://localhost:<port><path> pattern
	idx := strings.Index(cmdStr, "http://localhost:")
	if idx < 0 {
		idx = strings.Index(cmdStr, "http://127.0.0.1:")
	}
	if idx < 0 {
		return "", 0
	}

	rest := cmdStr[idx+len("http://localhost:"):]
	if strings.HasPrefix(cmdStr[idx:], "http://127.0.0.1:") {
		rest = cmdStr[idx+len("http://127.0.0.1:"):]
	}

	// Parse port and path: "3000/health" or "3000/health || exit 1"
	var portStr, path string
	slashIdx := strings.Index(rest, "/")
	if slashIdx > 0 {
		portStr = rest[:slashIdx]
		pathRest := rest[slashIdx:]
		// Trim trailing junk (|| exit 1, quotes, etc.)
		for _, sep := range []string{" ", "'", "\""} {
			if i := strings.Index(pathRest, sep); i > 0 {
				pathRest = pathRest[:i]
			}
		}
		path = pathRest
	} else {
		// No path, just port
		portStr = strings.Fields(rest)[0]
		path = "/health"
	}

	port, _ := strconv.Atoi(portStr)
	if path == "" {
		path = "/health"
	}
	return path, port
}
