package main

import (
	"context"
	"time"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/docker"
)

// fakeCompose is a test double for the Compose interface that records the
// call counts the current tests assert on. All calls succeed.
type fakeCompose struct {
	app string

	buildCalls int
	upCalls    int
	tagCalls   int
}

func (f *fakeCompose) Build(_ context.Context, _ map[string]string) error {
	f.buildCalls++
	return nil
}

func (f *fakeCompose) Run(_ context.Context, _ string, _ []string) error { return nil }

func (f *fakeCompose) Up(_ context.Context, _ []string) error {
	f.upCalls++
	return nil
}

func (f *fakeCompose) TagRollbackImages(_ context.Context) error {
	f.tagCalls++
	return nil
}

func (f *fakeCompose) ProjectName() string { return "jib-" + f.app }

// fakeDocker is a test double for the DockerClient interface. Configure
// imageExistsResult and allHealthyResult per-test; newFakeDocker defaults
// to "present" and "healthy" for happy-path tests.
type fakeDocker struct {
	compose *fakeCompose

	imageExistsResult bool
	allHealthyResult  bool

	pruneCalls            int
	generateOverrideCalls int
}

func newFakeDocker() *fakeDocker {
	return &fakeDocker{
		imageExistsResult: true,
		allHealthyResult:  true,
	}
}

func (f *fakeDocker) NewCompose(app, _ string, _ []string, _, _ string) Compose {
	if f.compose == nil {
		f.compose = &fakeCompose{app: app}
	}
	return f.compose
}

func (f *fakeDocker) OverridePath(overrideDir, app string) string {
	return overrideDir + "/" + app + ".override.yml"
}

func (f *fakeDocker) NeedsGeneratedCompose(_ string, _ []string) bool { return false }

func (f *fakeDocker) GenerateComposeForDockerfile(_, _, _ string, _ int) (string, int, error) {
	return "", 0, nil
}

func (f *fakeDocker) GenerateOverride(_ context.Context, _ string, _ []string, _, _ string) (string, error) {
	f.generateOverrideCalls++
	return "", nil
}

func (f *fakeDocker) ImageExists(_ context.Context, _ string) bool {
	return f.imageExistsResult
}

func (f *fakeDocker) CheckHealth(_ context.Context, _ []config.HealthCheck, _ time.Duration) []docker.HealthResult {
	return nil
}

func (f *fakeDocker) AllHealthy(_ []docker.HealthResult) bool {
	return f.allHealthyResult
}

func (f *fakeDocker) PruneImages(_ context.Context) error {
	f.pruneCalls++
	return nil
}
