package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/git"
	"github.com/hexnickk/jib/internal/secrets"
	"github.com/hexnickk/jib/internal/state"
)

// initTestRepo creates a bare remote and a cloned working repo in tmpDir,
// returning (repoDir, remotePath). The repo has one commit on "main".
func initTestRepo(t *testing.T, tmpDir string) (string, string) {
	t.Helper()

	remoteDir := filepath.Join(tmpDir, "remote.git")
	repoDir := filepath.Join(tmpDir, "repo")

	// Create bare remote.
	run(t, "", "git", "init", "--bare", remoteDir)

	// Clone it.
	run(t, "", "git", "clone", remoteDir, repoDir)

	// Configure user for commits.
	run(t, repoDir, "git", "config", "user.email", "test@test.com")
	run(t, repoDir, "git", "config", "user.name", "Test")

	// Create initial commit on main.
	testFile := filepath.Join(repoDir, "hello.txt")
	if err := os.WriteFile(testFile, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	run(t, repoDir, "git", "add", ".")
	run(t, repoDir, "git", "commit", "-m", "initial commit")
	run(t, repoDir, "git", "push", "origin", "HEAD:main")

	return repoDir, remoteDir
}

// run executes a command and fails the test on error.
func run(t *testing.T, dir string, name string, args ...string) {
	t.Helper()
	cmd := exec.Command(name, args...) //nolint:gosec // test helper
	if dir != "" {
		cmd.Dir = dir
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%s %v failed: %v\n%s", name, args, err, string(out))
	}
}

func TestCheckDiskSpace(t *testing.T) {
	// Should pass on current filesystem (test machines have more than 2GB).
	err := checkDiskSpace(os.TempDir(), minDiskBytes)
	if err != nil {
		t.Fatalf("checkDiskSpace failed on temp dir: %v", err)
	}
}

func TestCheckDiskSpaceNonExistentPath(t *testing.T) {
	// Should walk up to an existing parent directory.
	err := checkDiskSpace("/tmp/does-not-exist/at-all/deep", minDiskBytes)
	if err != nil {
		t.Fatalf("checkDiskSpace failed on non-existent path: %v", err)
	}
}

func TestCheckDiskSpaceHugeMinimum(t *testing.T) {
	// Requesting an absurdly large minimum should fail.
	err := checkDiskSpace(os.TempDir(), 1<<62)
	if err == nil {
		t.Fatal("expected error for huge minimum disk space, got nil")
	}
}

func TestGitCurrentSHA(t *testing.T) {
	tmpDir := t.TempDir()
	repoDir, _ := initTestRepo(t, tmpDir)

	ctx := context.Background()
	sha, err := git.CurrentSHA(ctx, repoDir)
	if err != nil {
		t.Fatalf("GitCurrentSHA failed: %v", err)
	}
	if len(sha) != 40 {
		t.Fatalf("expected 40-char SHA, got %q (len=%d)", sha, len(sha))
	}
}

func TestGitRemoteSHA(t *testing.T) {
	tmpDir := t.TempDir()
	repoDir, _ := initTestRepo(t, tmpDir)

	ctx := context.Background()
	sha, err := git.RemoteSHA(ctx, repoDir, "main")
	if err != nil {
		t.Fatalf("GitRemoteSHA failed: %v", err)
	}
	if len(sha) != 40 {
		t.Fatalf("expected 40-char SHA, got %q (len=%d)", sha, len(sha))
	}

	// Remote SHA should match current SHA since we just pushed.
	current, _ := git.CurrentSHA(ctx, repoDir)
	if sha != current {
		t.Fatalf("remote SHA %s != current SHA %s", sha, current)
	}
}

func TestGitFetch(t *testing.T) {
	tmpDir := t.TempDir()
	repoDir, remoteDir := initTestRepo(t, tmpDir)
	ctx := context.Background()

	// Push a new commit to the remote via a second clone.
	clone2 := filepath.Join(tmpDir, "clone2")
	run(t, "", "git", "clone", "-b", "main", remoteDir, clone2)
	run(t, clone2, "git", "config", "user.email", "test@test.com")
	run(t, clone2, "git", "config", "user.name", "Test")
	if err := os.WriteFile(filepath.Join(clone2, "new.txt"), []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	run(t, clone2, "git", "add", ".")
	run(t, clone2, "git", "commit", "-m", "second commit")
	run(t, clone2, "git", "push", "origin", "main")

	// Fetch in original repo.
	if err := git.Fetch(ctx, repoDir, "main"); err != nil {
		t.Fatalf("GitFetch failed: %v", err)
	}

	// Now remote SHA should differ from current.
	remoteSHA, _ := git.RemoteSHA(ctx, repoDir, "main")
	currentSHA, _ := git.CurrentSHA(ctx, repoDir)
	if remoteSHA == currentSHA {
		t.Fatal("remote SHA should differ from current after fetch without checkout")
	}
}

func TestGitCheckout(t *testing.T) {
	tmpDir := t.TempDir()
	repoDir, remoteDir := initTestRepo(t, tmpDir)
	ctx := context.Background()

	// Record initial SHA.
	initialSHA, _ := git.CurrentSHA(ctx, repoDir)

	// Push a new commit from a second clone.
	clone2 := filepath.Join(tmpDir, "clone2")
	run(t, "", "git", "clone", "-b", "main", remoteDir, clone2)
	run(t, clone2, "git", "config", "user.email", "test@test.com")
	run(t, clone2, "git", "config", "user.name", "Test")
	if err := os.WriteFile(filepath.Join(clone2, "new.txt"), []byte("data"), 0o600); err != nil {
		t.Fatal(err)
	}
	run(t, clone2, "git", "add", ".")
	run(t, clone2, "git", "commit", "-m", "new commit")
	run(t, clone2, "git", "push", "origin", "main")

	// Fetch and checkout.
	if err := git.Fetch(ctx, repoDir, "main"); err != nil {
		t.Fatalf("GitFetch failed: %v", err)
	}
	remoteSHA, _ := git.RemoteSHA(ctx, repoDir, "main")

	if err := git.Checkout(ctx, repoDir, remoteSHA); err != nil {
		t.Fatalf("GitCheckout failed: %v", err)
	}

	newSHA, _ := git.CurrentSHA(ctx, repoDir)
	if newSHA != remoteSHA {
		t.Fatalf("after checkout expected %s, got %s", remoteSHA, newSHA)
	}
	if newSHA == initialSHA {
		t.Fatal("SHA should have changed after checkout")
	}
}

func TestDeployNonExistentApp(t *testing.T) {
	tmpDir := t.TempDir()
	eng := &Engine{
		Config: &config.Config{
			Apps: map[string]config.App{},
		},
		StateStore: state.NewStore(filepath.Join(tmpDir, "state")),
		Secrets:    secrets.NewManager(filepath.Join(tmpDir, "secrets")),

		LockDir:     filepath.Join(tmpDir, "locks"),
		RepoBaseDir: filepath.Join(tmpDir, "repos"),
	}

	_, err := eng.Deploy(context.Background(), DeployOptions{
		App:     "nonexistent",
		Trigger: "manual",
		User:    "test",
	})
	if err == nil {
		t.Fatal("expected error for non-existent app")
	}
	if got := err.Error(); got != `app "nonexistent" not found in config` {
		t.Fatalf("unexpected error: %s", got)
	}
}

func TestDeployDryRunDoesNotModifyState(t *testing.T) {
	tmpDir := t.TempDir()
	stateDir := filepath.Join(tmpDir, "state")
	lockDir := filepath.Join(tmpDir, "locks")
	repoBaseDir := filepath.Join(tmpDir, "repos")
	appName := "testapp"

	// Create a real git repo for the app.
	appRepoDir := config.RepoPathIn(repoBaseDir, appName, "local")
	initTestRepo2(t, tmpDir, appRepoDir)

	eng := &Engine{
		Config: &config.Config{
			Apps: map[string]config.App{
				appName: {
					Repo:   "local",
					Branch: "main",
				},
			},
		},
		StateStore: state.NewStore(stateDir),
		Secrets:    secrets.NewManager(filepath.Join(tmpDir, "secrets")),

		LockDir:     lockDir,
		RepoBaseDir: repoBaseDir,
	}

	// Load state before.
	stateBefore, err := eng.StateStore.Load(appName)
	if err != nil {
		t.Fatal(err)
	}

	result, err := eng.Deploy(context.Background(), DeployOptions{
		App:     appName,
		DryRun:  true,
		Trigger: "manual",
		User:    "test",
	})
	if err != nil {
		t.Fatalf("dry-run deploy failed: %v", err)
	}
	if !result.Success {
		t.Fatalf("dry-run should succeed, got error: %s", result.Error)
	}

	// State should be unchanged.
	stateAfter, err := eng.StateStore.Load(appName)
	if err != nil {
		t.Fatal(err)
	}

	if stateBefore.DeployedSHA != stateAfter.DeployedSHA {
		t.Fatalf("state was modified by dry-run: deployed_sha changed from %q to %q",
			stateBefore.DeployedSHA, stateAfter.DeployedSHA)
	}
	if stateBefore.PreviousSHA != stateAfter.PreviousSHA {
		t.Fatalf("state was modified by dry-run: previous_sha changed from %q to %q",
			stateBefore.PreviousSHA, stateAfter.PreviousSHA)
	}
}

// initTestRepo2 creates a self-contained repo (with its own remote) at the given repoDir.
// Used when we need the repo to live at a specific path.
func initTestRepo2(t *testing.T, tmpDir, repoDir string) {
	t.Helper()

	remoteDir := filepath.Join(tmpDir, "remote.git")

	// Create bare remote.
	run(t, "", "git", "init", "--bare", remoteDir)

	// Clone to desired location.
	run(t, "", "git", "clone", remoteDir, repoDir)

	// Configure user for commits.
	run(t, repoDir, "git", "config", "user.email", "test@test.com")
	run(t, repoDir, "git", "config", "user.name", "Test")

	// Create initial commit.
	testFile := filepath.Join(repoDir, "hello.txt")
	if err := os.WriteFile(testFile, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	run(t, repoDir, "git", "add", ".")
	run(t, repoDir, "git", "commit", "-m", "initial commit")
	run(t, repoDir, "git", "push", "origin", "HEAD:main")
}

func TestRollbackNonExistentApp(t *testing.T) {
	tmpDir := t.TempDir()
	eng := &Engine{
		Config: &config.Config{
			Apps: map[string]config.App{},
		},
		StateStore: state.NewStore(filepath.Join(tmpDir, "state")),
		Secrets:    secrets.NewManager(filepath.Join(tmpDir, "secrets")),

		LockDir:     filepath.Join(tmpDir, "locks"),
		RepoBaseDir: filepath.Join(tmpDir, "repos"),
	}

	_, err := eng.Rollback(context.Background(), RollbackOptions{
		App:  "nonexistent",
		User: "test",
	})
	if err == nil {
		t.Fatal("expected error for non-existent app")
	}
}

func TestRollbackNoPreviousDeploy(t *testing.T) {
	tmpDir := t.TempDir()
	appName := "testapp"

	eng := &Engine{
		Config: &config.Config{
			Apps: map[string]config.App{
				appName: {
					Repo:   "local",
					Branch: "main",
				},
			},
		},
		StateStore: state.NewStore(filepath.Join(tmpDir, "state")),
		Secrets:    secrets.NewManager(filepath.Join(tmpDir, "secrets")),

		LockDir:     filepath.Join(tmpDir, "locks"),
		RepoBaseDir: filepath.Join(tmpDir, "repos"),
	}

	_, err := eng.Rollback(context.Background(), RollbackOptions{
		App:  appName,
		User: "test",
	})
	if err == nil {
		t.Fatal("expected error when no previous deploy exists")
	}
	expected := `no previous deploy found for app "testapp"`
	if err.Error() != expected {
		t.Fatalf("unexpected error: %s", err.Error())
	}
}

// initTwoCommitRepo creates a repo with two commits at the given path and
// returns (shaA, shaB) where shaA is the first commit and shaB the second.
func initTwoCommitRepo(t *testing.T, tmpDir, repoDir string) (string, string) {
	t.Helper()
	initTestRepo2(t, tmpDir, repoDir)

	shaA, err := git.CurrentSHA(context.Background(), repoDir)
	if err != nil {
		t.Fatal(err)
	}

	// Second commit.
	if err := os.WriteFile(filepath.Join(repoDir, "hello.txt"), []byte("v2"), 0o600); err != nil {
		t.Fatal(err)
	}
	run(t, repoDir, "git", "add", ".")
	run(t, repoDir, "git", "commit", "-m", "v2")
	run(t, repoDir, "git", "push", "origin", "HEAD:main")

	shaB, err := git.CurrentSHA(context.Background(), repoDir)
	if err != nil {
		t.Fatal(err)
	}
	return shaA, shaB
}

// newTestEngine returns an Engine wired with real StateStore/Secrets and the
// given fake docker, rooted under tmpDir. The app map contains one entry
// (appName) with a single "web" service — sufficient for Deploy/Rollback
// pipeline tests.
func newTestEngine(tmpDir, appName string, fake *fakeDocker) *Engine {
	return &Engine{
		Config: &config.Config{
			Apps: map[string]config.App{
				appName: {
					Repo:     "local",
					Branch:   "main",
					Services: []string{"web"},
				},
			},
		},
		StateStore:  state.NewStore(filepath.Join(tmpDir, "state")),
		Secrets:     secrets.NewManager(filepath.Join(tmpDir, "secrets")),
		Docker:      fake,
		LockDir:     filepath.Join(tmpDir, "locks"),
		RepoBaseDir: filepath.Join(tmpDir, "repos"),
		OverrideDir: filepath.Join(tmpDir, "overrides"),
	}
}

// seedState writes an initial AppState to the store with the given SHAs.
func seedState(t *testing.T, eng *Engine, appName, deployedSHA, previousSHA string) {
	t.Helper()
	s, err := eng.StateStore.Load(appName)
	if err != nil {
		t.Fatal(err)
	}
	s.DeployedSHA = deployedSHA
	s.PreviousSHA = previousSHA
	if err := eng.StateStore.Save(appName, s); err != nil {
		t.Fatal(err)
	}
}

func TestRollbackHappyPath(t *testing.T) {
	tmpDir := t.TempDir()
	appName := "testapp"
	repoDir := config.RepoPathIn(filepath.Join(tmpDir, "repos"), appName, "local")
	shaA, shaB := initTwoCommitRepo(t, tmpDir, repoDir)

	fake := newFakeDocker() // rollback image present, all healthy
	eng := newTestEngine(tmpDir, appName, fake)
	seedState(t, eng, appName, shaB, shaA)

	result, err := eng.Rollback(context.Background(), RollbackOptions{App: appName, User: "test"})
	if err != nil {
		t.Fatalf("rollback failed: %v", err)
	}
	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}

	// State must be swapped: deployed <- previous, previous <- old deployed.
	after, err := eng.StateStore.Load(appName)
	if err != nil {
		t.Fatal(err)
	}
	if after.DeployedSHA != shaA {
		t.Errorf("DeployedSHA: want %s, got %s", shaA, after.DeployedSHA)
	}
	if after.PreviousSHA != shaB {
		t.Errorf("PreviousSHA: want %s, got %s", shaB, after.PreviousSHA)
	}
	if after.LastDeployStatus != "success" {
		t.Errorf("LastDeployStatus: want success, got %s", after.LastDeployStatus)
	}
	if after.ConsecutiveFailures != 0 {
		t.Errorf("ConsecutiveFailures: want 0, got %d", after.ConsecutiveFailures)
	}

	// Repo HEAD must be at previous SHA.
	head, err := git.CurrentSHA(context.Background(), repoDir)
	if err != nil {
		t.Fatal(err)
	}
	if head != shaA {
		t.Errorf("repo HEAD: want %s, got %s", shaA, head)
	}

	// Rollback image present → Build must NOT have been called.
	if fake.compose == nil {
		t.Fatal("expected newCompose to be called")
	}
	if fake.compose.buildCalls != 0 {
		t.Errorf("expected 0 build calls (rollback image present), got %d", fake.compose.buildCalls)
	}
	if fake.compose.upCalls != 1 {
		t.Errorf("expected 1 up call, got %d", fake.compose.upCalls)
	}
}

func TestRollbackRebuildWhenImageMissing(t *testing.T) {
	tmpDir := t.TempDir()
	appName := "testapp"
	repoDir := config.RepoPathIn(filepath.Join(tmpDir, "repos"), appName, "local")
	shaA, shaB := initTwoCommitRepo(t, tmpDir, repoDir)

	fake := newFakeDocker()
	fake.imageExistsResult = false // no rollback image → rebuild required

	eng := newTestEngine(tmpDir, appName, fake)
	seedState(t, eng, appName, shaB, shaA)

	result, err := eng.Rollback(context.Background(), RollbackOptions{App: appName, User: "test"})
	if err != nil {
		t.Fatalf("rollback failed: %v", err)
	}
	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}

	if fake.compose == nil || fake.compose.buildCalls != 1 {
		t.Errorf("expected 1 build call (rollback image missing), got %+v", fake.compose)
	}
	if fake.compose.upCalls != 1 {
		t.Errorf("expected 1 up call, got %d", fake.compose.upCalls)
	}
}

func TestRollbackHealthCheckFailure(t *testing.T) {
	tmpDir := t.TempDir()
	appName := "testapp"
	repoDir := config.RepoPathIn(filepath.Join(tmpDir, "repos"), appName, "local")
	shaA, shaB := initTwoCommitRepo(t, tmpDir, repoDir)

	fake := newFakeDocker()
	fake.allHealthyResult = false // health check fails

	eng := newTestEngine(tmpDir, appName, fake)
	// Configure the app to have a health check so CheckHealth is called.
	app := eng.Config.Apps[appName]
	app.Health = []config.HealthCheck{{Path: "/health", Port: 8080}}
	eng.Config.Apps[appName] = app
	seedState(t, eng, appName, shaB, shaA)

	result, err := eng.Rollback(context.Background(), RollbackOptions{App: appName, User: "test"})
	if err != nil {
		t.Fatalf("rollback returned error (expected failure result, not error): %v", err)
	}
	if result.Success {
		t.Fatal("expected rollback to report failure on bad health check")
	}

	after, err := eng.StateStore.Load(appName)
	if err != nil {
		t.Fatal(err)
	}
	if after.LastDeployStatus != "failure" {
		t.Errorf("LastDeployStatus: want failure, got %s", after.LastDeployStatus)
	}
	if after.ConsecutiveFailures != 1 {
		t.Errorf("ConsecutiveFailures: want 1, got %d", after.ConsecutiveFailures)
	}
	// State still swaps (rollback completed the action, just reports unhealthy).
	if after.DeployedSHA != shaA {
		t.Errorf("DeployedSHA should still swap on health failure; want %s, got %s", shaA, after.DeployedSHA)
	}
}

func TestDeployHappyPath(t *testing.T) {
	tmpDir := t.TempDir()
	appName := "testapp"
	repoDir := config.RepoPathIn(filepath.Join(tmpDir, "repos"), appName, "local")
	initTestRepo2(t, tmpDir, repoDir)

	sha, err := git.CurrentSHA(context.Background(), repoDir)
	if err != nil {
		t.Fatal(err)
	}

	fake := newFakeDocker()
	eng := newTestEngine(tmpDir, appName, fake)
	// No seeded state → previousSHA is "", differs from current, so the
	// "already at target" skip condition on deploy.go:105 does not fire.

	result, err := eng.Deploy(context.Background(), DeployOptions{
		App:     appName,
		Trigger: "manual",
		User:    "test",
	})
	if err != nil {
		t.Fatalf("deploy failed: %v", err)
	}
	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}
	if result.DeployedSHA != sha {
		t.Errorf("DeployedSHA: want %s, got %s", sha, result.DeployedSHA)
	}

	// Verify the full pipeline ran: build, up, tagRollback, prune.
	if fake.compose == nil {
		t.Fatal("expected newCompose to be called")
	}
	if fake.compose.buildCalls != 1 {
		t.Errorf("build calls: want 1, got %d", fake.compose.buildCalls)
	}
	if fake.compose.upCalls != 1 {
		t.Errorf("up calls: want 1, got %d", fake.compose.upCalls)
	}
	if fake.compose.tagCalls != 1 {
		t.Errorf("tag calls: want 1, got %d", fake.compose.tagCalls)
	}
	if fake.pruneCalls != 1 {
		t.Errorf("prune calls: want 1, got %d", fake.pruneCalls)
	}
	if fake.generateOverrideCalls != 1 {
		t.Errorf("generateOverride calls: want 1, got %d", fake.generateOverrideCalls)
	}

	// State updated with the deployed SHA.
	after, err := eng.StateStore.Load(appName)
	if err != nil {
		t.Fatal(err)
	}
	if after.DeployedSHA != sha {
		t.Errorf("state DeployedSHA: want %s, got %s", sha, after.DeployedSHA)
	}
	if after.LastDeployStatus != "success" {
		t.Errorf("LastDeployStatus: want success, got %s", after.LastDeployStatus)
	}
}
