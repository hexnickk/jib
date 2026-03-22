package docker

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// Compose runs docker compose commands for an app.
type Compose struct {
	App      string   // app name, used for project prefix "jib-<app>"
	Dir      string   // working directory (repo checkout dir)
	Files    []string // compose files (-f flags)
	EnvFile  string   // path to .env file (if any)
	Override string   // path to jib-generated override file (if any)
}

// ProjectName returns the compose project name for this app.
func (c *Compose) ProjectName() string {
	return "jib-" + c.App
}

// baseArgs returns the common docker compose arguments:
// compose -p jib-<app> -f file1 -f file2 ... [-f override]
func (c *Compose) baseArgs() []string {
	args := []string{"compose", "-p", c.ProjectName()}
	for _, f := range c.Files {
		args = append(args, "-f", f)
	}
	if c.Override != "" {
		if _, err := os.Stat(c.Override); err == nil {
			args = append(args, "-f", c.Override)
		}
	}
	return args
}

// envFileArgs returns --env-file flag if EnvFile is set.
func (c *Compose) envFileArgs() []string {
	if c.EnvFile != "" {
		return []string{"--env-file", c.EnvFile}
	}
	return nil
}

// runInteractive runs a docker command with stdout/stderr piped to os.Stdout/os.Stderr.
func (c *Compose) runInteractive(ctx context.Context, args []string, extraEnv []string) error {
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Dir = c.Dir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if len(extraEnv) > 0 {
		cmd.Env = append(os.Environ(), extraEnv...)
	}
	return cmd.Run()
}

// runCapture runs a docker command and returns its combined output.
func (c *Compose) runCapture(ctx context.Context, args []string) (string, error) {
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Dir = c.Dir
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// Build runs docker compose build with optional build args passed as env vars.
func (c *Compose) Build(ctx context.Context, buildArgs map[string]string) error {
	args := c.baseArgs()
	args = append(args, c.envFileArgs()...)
	args = append(args, "build")

	var env []string
	for k, v := range buildArgs {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	return c.runInteractive(ctx, args, env)
}

// Up runs docker compose up -d --force-recreate --remove-orphans with optional service list.
func (c *Compose) Up(ctx context.Context, services []string) error {
	args := c.baseArgs()
	args = append(args, c.envFileArgs()...)
	args = append(args, "up", "-d", "--force-recreate", "--remove-orphans")
	args = append(args, services...)
	return c.runInteractive(ctx, args, nil)
}

// Down runs docker compose down.
func (c *Compose) Down(ctx context.Context) error {
	args := c.baseArgs()
	args = append(args, "down")
	return c.runInteractive(ctx, args, nil)
}

// Run runs docker compose run --rm <service> [cmd...].
func (c *Compose) Run(ctx context.Context, service string, cmd []string) error {
	args := c.baseArgs()
	args = append(args, c.envFileArgs()...)
	args = append(args, "run", "--rm", service)
	args = append(args, cmd...)
	return c.runInteractive(ctx, args, nil)
}

// Exec runs docker compose exec <service> [cmd...].
func (c *Compose) Exec(ctx context.Context, service string, cmd []string) error {
	args := c.baseArgs()
	args = append(args, "exec", service)
	args = append(args, cmd...)
	return c.runInteractive(ctx, args, nil)
}

// Restart runs docker compose restart with optional service list.
func (c *Compose) Restart(ctx context.Context, services []string) error {
	args := c.baseArgs()
	args = append(args, "restart")
	args = append(args, services...)
	return c.runInteractive(ctx, args, nil)
}

// Logs runs docker compose logs for a service with optional follow and tail.
func (c *Compose) Logs(ctx context.Context, service string, follow bool, tail int) error {
	args := c.baseArgs()
	args = append(args, "logs")
	if follow {
		args = append(args, "-f")
	}
	if tail > 0 {
		args = append(args, "--tail", fmt.Sprintf("%d", tail))
	}
	if service != "" {
		args = append(args, service)
	}
	return c.runInteractive(ctx, args, nil)
}

// PS runs docker compose ps and returns the output.
func (c *Compose) PS(ctx context.Context) (string, error) {
	args := c.baseArgs()
	args = append(args, "ps")
	return c.runCapture(ctx, args)
}
