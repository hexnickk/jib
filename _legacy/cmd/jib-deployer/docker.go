package main

import (
	"context"
	"time"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/docker"
)

// Compose is the subset of docker.Compose operations the engine needs.
// Defining it in the consumer package lets tests swap in a fake without
// importing the real docker package.
type Compose interface {
	Build(ctx context.Context, buildArgs map[string]string) error
	Run(ctx context.Context, service string, cmd []string) error
	Up(ctx context.Context, services []string) error
	TagRollbackImages(ctx context.Context) error
	ProjectName() string
}

// DockerClient is the facade the engine uses for all docker interactions.
// Production wires up realDocker (delegates to internal/docker); tests wire
// up fakeDocker (captures calls, returns stubbed values).
type DockerClient interface {
	NewCompose(app, dir string, files []string, envFile, override string) Compose
	OverridePath(overrideDir, app string) string
	NeedsGeneratedCompose(repoDir string, composeFiles []string) bool
	GenerateComposeForDockerfile(app, repoDir, overrideDir string, hostPort int) (string, int, error)
	GenerateOverride(ctx context.Context, app string, composeFiles []string, repoDir, overrideDir string) (string, error)
	ImageExists(ctx context.Context, tag string) bool
	CheckHealth(ctx context.Context, checks []config.HealthCheck, warmup time.Duration) []docker.HealthResult
	AllHealthy(results []docker.HealthResult) bool
	PruneImages(ctx context.Context) error
}

// realDocker is the production DockerClient, delegating every method to the
// real internal/docker package. Every method here is a one-to-one passthrough —
// no logic, so regressions would come only from a typo, which code review plus
// the "production-path" tests catch.
type realDocker struct{}

func (realDocker) NewCompose(app, dir string, files []string, envFile, override string) Compose {
	return &docker.Compose{
		App:      app,
		Dir:      dir,
		Files:    files,
		EnvFile:  envFile,
		Override: override,
	}
}

func (realDocker) OverridePath(overrideDir, app string) string {
	return docker.OverridePath(overrideDir, app)
}

func (realDocker) NeedsGeneratedCompose(repoDir string, composeFiles []string) bool {
	return docker.NeedsGeneratedCompose(repoDir, composeFiles)
}

func (realDocker) GenerateComposeForDockerfile(app, repoDir, overrideDir string, hostPort int) (string, int, error) {
	return docker.GenerateComposeForDockerfile(app, repoDir, overrideDir, hostPort)
}

func (realDocker) GenerateOverride(ctx context.Context, app string, composeFiles []string, repoDir, overrideDir string) (string, error) {
	return docker.GenerateOverride(ctx, app, composeFiles, repoDir, overrideDir)
}

func (realDocker) ImageExists(ctx context.Context, tag string) bool {
	return docker.ImageExists(ctx, tag)
}

func (realDocker) CheckHealth(ctx context.Context, checks []config.HealthCheck, warmup time.Duration) []docker.HealthResult {
	return docker.CheckHealth(ctx, checks, warmup)
}

func (realDocker) AllHealthy(results []docker.HealthResult) bool {
	return docker.AllHealthy(results)
}

func (realDocker) PruneImages(ctx context.Context) error {
	return docker.PruneImages(ctx)
}
