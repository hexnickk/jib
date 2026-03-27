package deploy

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/hexnickk/jib/internal/config"
	"github.com/hexnickk/jib/internal/git"
	"github.com/hexnickk/jib/internal/notify"
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
		StateStore:  state.NewStore(filepath.Join(tmpDir, "state")),
		Secrets:     secrets.NewManager(filepath.Join(tmpDir, "secrets")),
		Notifier:    notify.NewMulti(),
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
	appRepoDir := RepoPath(repoBaseDir, appName, "local")
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
		StateStore:  state.NewStore(stateDir),
		Secrets:     secrets.NewManager(filepath.Join(tmpDir, "secrets")),
		Notifier:    notify.NewMulti(),
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
		StateStore:  state.NewStore(filepath.Join(tmpDir, "state")),
		Secrets:     secrets.NewManager(filepath.Join(tmpDir, "secrets")),
		Notifier:    notify.NewMulti(),
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
		StateStore:  state.NewStore(filepath.Join(tmpDir, "state")),
		Secrets:     secrets.NewManager(filepath.Join(tmpDir, "secrets")),
		Notifier:    notify.NewMulti(),
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
