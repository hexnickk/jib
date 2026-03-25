package secrets

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/hexnickk/jib/internal/config"
)

func TestSetCopiesFileWithCorrectPermissions(t *testing.T) {
	base := t.TempDir()
	m := NewManager(base)

	// Create a source file.
	srcDir := t.TempDir()
	srcPath := filepath.Join(srcDir, "source.env")
	if err := os.WriteFile(srcPath, []byte("SECRET=hello\n"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := m.Set("myapp", srcPath, ""); err != nil {
		t.Fatalf("Set failed: %v", err)
	}

	// Check directory permissions.
	dirInfo, err := os.Stat(filepath.Join(base, "myapp"))
	if err != nil {
		t.Fatal(err)
	}
	if perm := dirInfo.Mode().Perm(); perm != 0700 {
		t.Errorf("directory permissions = %o, want 0700", perm)
	}

	// Check file permissions.
	filePath := filepath.Join(base, "myapp", ".env")
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if perm := fileInfo.Mode().Perm(); perm != 0600 {
		t.Errorf("file permissions = %o, want 0600", perm)
	}

	// Check content.
	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "SECRET=hello\n" {
		t.Errorf("content = %q, want %q", string(data), "SECRET=hello\n")
	}
}

func TestSetOverwritesExisting(t *testing.T) {
	base := t.TempDir()
	m := NewManager(base)

	srcDir := t.TempDir()
	src1 := filepath.Join(srcDir, "v1.env")
	src2 := filepath.Join(srcDir, "v2.env")
	if err := os.WriteFile(src1, []byte("V=1\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(src2, []byte("V=2\n"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := m.Set("myapp", src1, ""); err != nil {
		t.Fatal(err)
	}
	if err := m.Set("myapp", src2, ""); err != nil {
		t.Fatal(err)
	}

	data, _ := os.ReadFile(filepath.Join(base, "myapp", ".env"))
	if string(data) != "V=2\n" {
		t.Errorf("content after overwrite = %q, want %q", string(data), "V=2\n")
	}

	// Permissions should still be correct after overwrite.
	fi, _ := os.Stat(filepath.Join(base, "myapp", ".env"))
	if perm := fi.Mode().Perm(); perm != 0600 {
		t.Errorf("file permissions after overwrite = %o, want 0600", perm)
	}
}

func TestSetCustomEnvFileName(t *testing.T) {
	base := t.TempDir()
	m := NewManager(base)

	srcDir := t.TempDir()
	srcPath := filepath.Join(srcDir, "prod.env")
	if err := os.WriteFile(srcPath, []byte("KEY=val\n"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := m.Set("myapp", srcPath, ".env.production"); err != nil {
		t.Fatal(err)
	}

	filePath := filepath.Join(base, "myapp", ".env.production")
	if _, err := os.Stat(filePath); err != nil {
		t.Errorf("expected file at %s, got error: %v", filePath, err)
	}
}

func TestCheckReturnsTrueFalse(t *testing.T) {
	base := t.TempDir()
	m := NewManager(base)

	// Before setting, should not exist.
	exists, path := m.Check("myapp", "")
	if exists {
		t.Error("Check returned true before Set")
	}
	if want := filepath.Join(base, "myapp", ".env"); path != want {
		t.Errorf("path = %q, want %q", path, want)
	}

	// Set the secret.
	srcDir := t.TempDir()
	srcPath := filepath.Join(srcDir, "s.env")
	if err := os.WriteFile(srcPath, []byte("X=1\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := m.Set("myapp", srcPath, ""); err != nil {
		t.Fatal(err)
	}

	exists, _ = m.Check("myapp", "")
	if !exists {
		t.Error("Check returned false after Set")
	}
}

func TestCheckAllMixedApps(t *testing.T) {
	base := t.TempDir()
	m := NewManager(base)

	// Create secrets for "appA" only.
	srcDir := t.TempDir()
	srcPath := filepath.Join(srcDir, "s.env")
	if err := os.WriteFile(srcPath, []byte("X=1\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := m.Set("appA", srcPath, ""); err != nil {
		t.Fatal(err)
	}

	apps := map[string]config.App{
		"appA": {SecretsEnv: true},
		"appB": {SecretsEnv: true},
		"appC": {SecretsEnv: false}, // should be skipped
		"appD": {SecretsEnv: true, EnvFile: ".env.local"},
	}

	results := m.CheckAll(apps)

	// Should have 3 results (appA, appB, appD — appC is skipped).
	if len(results) != 3 {
		t.Fatalf("got %d results, want 3", len(results))
	}

	// Sort for deterministic checks.
	sort.Slice(results, func(i, j int) bool {
		return results[i].App < results[j].App
	})

	if !results[0].Exists || results[0].App != "appA" {
		t.Errorf("appA: exists=%v, want true", results[0].Exists)
	}
	if results[1].Exists || results[1].App != "appB" {
		t.Errorf("appB: exists=%v, want false", results[1].Exists)
	}
	if results[2].App != "appD" {
		t.Errorf("expected appD, got %s", results[2].App)
	}
	if !strings.HasSuffix(results[2].Path, ".env.local") {
		t.Errorf("appD path = %q, want suffix .env.local", results[2].Path)
	}
}

func TestRemoveDeletesDirectory(t *testing.T) {
	base := t.TempDir()
	m := NewManager(base)

	// Set a secret first.
	srcDir := t.TempDir()
	srcPath := filepath.Join(srcDir, "s.env")
	if err := os.WriteFile(srcPath, []byte("X=1\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := m.Set("myapp", srcPath, ""); err != nil {
		t.Fatal(err)
	}

	if err := m.Remove("myapp"); err != nil {
		t.Fatalf("Remove failed: %v", err)
	}

	if _, err := os.Stat(filepath.Join(base, "myapp")); !os.IsNotExist(err) {
		t.Error("directory still exists after Remove")
	}
}

func TestRemoveNonexistentIsNoOp(t *testing.T) {
	base := t.TempDir()
	m := NewManager(base)

	if err := m.Remove("doesnotexist"); err != nil {
		t.Fatalf("Remove of nonexistent dir failed: %v", err)
	}
}

func TestSymlinkPath(t *testing.T) {
	m := NewManager("/opt/jib/secrets")

	got := m.SymlinkPath("myapp", "")
	want := "/opt/jib/secrets/myapp/.env"
	if got != want {
		t.Errorf("SymlinkPath = %q, want %q", got, want)
	}

	got = m.SymlinkPath("myapp", ".env.production")
	want = "/opt/jib/secrets/myapp/.env.production"
	if got != want {
		t.Errorf("SymlinkPath = %q, want %q", got, want)
	}
}

func TestSymlinkCreatesWorkingSymlink(t *testing.T) {
	base := t.TempDir()
	m := NewManager(base)

	// Set up the secrets file.
	srcDir := t.TempDir()
	srcPath := filepath.Join(srcDir, "s.env")
	if err := os.WriteFile(srcPath, []byte("DB=postgres://localhost\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := m.Set("myapp", srcPath, ""); err != nil {
		t.Fatal(err)
	}

	// Create a repo directory.
	repoDir := t.TempDir()

	if err := m.Symlink("myapp", repoDir, ""); err != nil {
		t.Fatalf("Symlink failed: %v", err)
	}

	linkPath := filepath.Join(repoDir, ".env")

	// Verify it's a symlink.
	fi, err := os.Lstat(linkPath)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Error("expected a symlink")
	}

	// Verify it points to the right target.
	target, err := os.Readlink(linkPath)
	if err != nil {
		t.Fatal(err)
	}
	wantTarget := filepath.Join(base, "myapp", ".env")
	if target != wantTarget {
		t.Errorf("symlink target = %q, want %q", target, wantTarget)
	}

	// Verify content is readable through the symlink.
	data, err := os.ReadFile(linkPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "DB=postgres://localhost\n" {
		t.Errorf("content via symlink = %q", string(data))
	}
}

func TestSymlinkReplacesExistingFile(t *testing.T) {
	base := t.TempDir()
	m := NewManager(base)

	// Set up secrets.
	srcDir := t.TempDir()
	srcPath := filepath.Join(srcDir, "s.env")
	if err := os.WriteFile(srcPath, []byte("NEW=value\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := m.Set("myapp", srcPath, ""); err != nil {
		t.Fatal(err)
	}

	// Create a repo directory with an existing .env file.
	repoDir := t.TempDir()
	existingPath := filepath.Join(repoDir, ".env")
	if err := os.WriteFile(existingPath, []byte("OLD=stuff\n"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := m.Symlink("myapp", repoDir, ""); err != nil {
		t.Fatalf("Symlink failed: %v", err)
	}

	// Should now be a symlink, not a regular file.
	fi, err := os.Lstat(existingPath)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Error("expected a symlink, got a regular file")
	}

	data, _ := os.ReadFile(existingPath)
	if string(data) != "NEW=value\n" {
		t.Errorf("content = %q, want %q", string(data), "NEW=value\n")
	}
}

func TestEnvRedacted(t *testing.T) {
	base := t.TempDir()
	m := NewManager(base)

	content := strings.Join([]string{
		"# Database config",
		"",
		"DATABASE_URL=file:./storage/main.db",
		"RESEND_API_KEY=re_abc123",
		"SHORT=hi",
		"EMPTY=",
		"EXACTLY10=1234567890",
		"ELEVEN_CHR=12345678901",
	}, "\n")

	srcDir := t.TempDir()
	srcPath := filepath.Join(srcDir, "s.env")
	if err := os.WriteFile(srcPath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	if err := m.Set("myapp", srcPath, ""); err != nil {
		t.Fatal(err)
	}

	lines, err := m.EnvRedacted("myapp", "")
	if err != nil {
		t.Fatalf("EnvRedacted failed: %v", err)
	}

	expected := []string{
		"# Database config",
		"",
		"DATABASE_URL=file***",   // >4 chars, first 4 shown
		"RESEND_API_KEY=re_a***", // >4 chars, first 4 shown
		"SHORT=***",              // <=4 chars, fully redacted
		"EMPTY=",                 // empty, shown as-is
		"EXACTLY10=1234***",      // >4 chars, first 4 shown
		"ELEVEN_CHR=1234***",     // >4 chars, first 4 shown
	}

	if len(lines) != len(expected) {
		t.Fatalf("got %d lines, want %d\ngot:  %v\nwant: %v", len(lines), len(expected), lines, expected)
	}

	for i, want := range expected {
		if lines[i] != want {
			t.Errorf("line %d = %q, want %q", i, lines[i], want)
		}
	}
}

func TestEnvRedactedFileNotFound(t *testing.T) {
	base := t.TempDir()
	m := NewManager(base)

	_, err := m.EnvRedacted("nonexistent", "")
	if err == nil {
		t.Error("expected error for nonexistent app")
	}
}
