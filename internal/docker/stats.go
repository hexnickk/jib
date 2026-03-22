package docker

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// Stats returns container resource usage for this app's containers.
// It runs docker stats --no-stream filtered to containers with the jib-<app> prefix.
func (c *Compose) Stats(ctx context.Context) (string, error) {
	// Get container IDs matching the project prefix
	psCmd := exec.CommandContext(ctx, "docker", "ps", "-q", "--filter", fmt.Sprintf("label=com.docker.compose.project=%s", c.ProjectName()))
	psOut, err := psCmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("listing containers: %w: %s", err, string(psOut))
	}

	ids := strings.Fields(strings.TrimSpace(string(psOut)))
	if len(ids) == 0 {
		return fmt.Sprintf("No running containers for %s", c.ProjectName()), nil
	}

	args := []string{"stats", "--no-stream", "--format", "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"}
	args = append(args, ids...)

	cmd := exec.CommandContext(ctx, "docker", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("getting stats: %w: %s", err, string(out))
	}

	return strings.TrimSpace(string(out)), nil
}
