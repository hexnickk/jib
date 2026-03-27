package docker

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// TagRollbackImages tags current images for each service as jib-<app>-<service>:rollback
// before pruning. This ensures multi-service apps can roll back all services.
func (c *Compose) TagRollbackImages(ctx context.Context) error {
	// Get service→image mapping using docker compose images (non-quiet).
	args := c.baseArgs()
	args = append(args, "images", "--format", "{{.Service}} {{.ID}}")
	out, err := c.runCapture(ctx, args)
	if err != nil {
		return fmt.Errorf("getting compose images: %w: %s", err, out)
	}

	lines := strings.Split(strings.TrimSpace(out), "\n")
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		service, imageID := fields[0], fields[1]
		rollbackTag := fmt.Sprintf("%s-%s:rollback", c.ProjectName(), service)
		tagCmd := exec.CommandContext(ctx, "docker", "tag", imageID, rollbackTag) //nolint:gosec // args constructed internally
		if tagOut, tagErr := tagCmd.CombinedOutput(); tagErr != nil {
			return fmt.Errorf("tagging image %s as %s: %w: %s", imageID, rollbackTag, tagErr, string(tagOut))
		}
	}

	return nil
}

// PruneImages runs docker image prune -f.
func PruneImages(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, "docker", "image", "prune", "-f") //nolint:gosec // trusted CLI subprocess
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("pruning images: %w: %s", err, string(out))
	}
	return nil
}

// ImageExists checks if a docker image with the given tag exists locally.
func ImageExists(ctx context.Context, tag string) bool {
	cmd := exec.CommandContext(ctx, "docker", "image", "inspect", tag) //nolint:gosec // args constructed internally
	return cmd.Run() == nil
}
