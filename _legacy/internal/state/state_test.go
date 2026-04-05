package state

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSaveLoadRoundtrip(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	now := time.Now().Truncate(time.Second)
	original := &AppState{
		App:                 "myapp",
		Strategy:            "restart",
		DeployedSHA:         "abc123",
		PreviousSHA:         "def456",
		Pinned:              true,
		LastDeploy:          now,
		LastDeployStatus:    "success",
		LastDeployError:     "",
		LastDeployTrigger:   "manual",
		LastDeployUser:      "nick",
		ConsecutiveFailures: 0,
	}

	if err := store.Save("myapp", original); err != nil {
		t.Fatalf("Save: %v", err)
	}

	loaded, err := store.Load("myapp")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if loaded.App != original.App {
		t.Errorf("App = %q, want %q", loaded.App, original.App)
	}
	if loaded.DeployedSHA != original.DeployedSHA {
		t.Errorf("DeployedSHA = %q, want %q", loaded.DeployedSHA, original.DeployedSHA)
	}
	if loaded.Pinned != original.Pinned {
		t.Errorf("Pinned = %v, want %v", loaded.Pinned, original.Pinned)
	}
	if !loaded.LastDeploy.Equal(original.LastDeploy) {
		t.Errorf("LastDeploy = %v, want %v", loaded.LastDeploy, original.LastDeploy)
	}
}

func TestLoadNonExistent(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	st, err := store.Load("noexist")
	if err != nil {
		t.Fatalf("Load non-existent: %v", err)
	}
	if st.App != "" {
		t.Errorf("expected empty App, got %q", st.App)
	}
	if st.SchemaVersion != 0 {
		t.Errorf("expected SchemaVersion 0, got %d", st.SchemaVersion)
	}
}

func TestLoadRefusesFutureSchema(t *testing.T) {
	dir := t.TempDir()

	future := AppState{SchemaVersion: CurrentSchemaVersion + 1, App: "futureapp"}
	data, _ := json.Marshal(future)
	if err := os.WriteFile(filepath.Join(dir, "futureapp.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}

	store := NewStore(dir)
	_, err := store.Load("futureapp")
	if err == nil {
		t.Fatal("expected error for future schema_version, got nil")
	}
}

func TestAtomicWriteNoTmpLeftover(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	st := &AppState{App: "atomictest"}
	if err := store.Save("atomictest", st); err != nil {
		t.Fatal(err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}

	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".tmp" {
			t.Errorf("leftover tmp file found: %s", e.Name())
		}
	}

	// Verify the final file exists and is valid JSON.
	data, err := os.ReadFile(filepath.Join(dir, "atomictest.json")) //nolint:gosec // test file with known path
	if err != nil {
		t.Fatalf("state file not found: %v", err)
	}
	var loaded AppState
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatalf("state file is not valid JSON: %v", err)
	}
}

func TestList(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	for _, app := range []string{"alpha", "beta", "gamma"} {
		if err := store.Save(app, &AppState{App: app}); err != nil {
			t.Fatal(err)
		}
	}

	apps, err := store.List()
	if err != nil {
		t.Fatal(err)
	}

	if len(apps) != 3 {
		t.Fatalf("List returned %d apps, want 3", len(apps))
	}

	want := map[string]bool{"alpha": true, "beta": true, "gamma": true}
	for _, a := range apps {
		if !want[a] {
			t.Errorf("unexpected app %q in List", a)
		}
	}
}

func TestListEmptyDir(t *testing.T) {
	dir := t.TempDir()
	// Remove the dir so it doesn't exist
	_ = os.Remove(dir)

	store := NewStore(dir)
	apps, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(apps) != 0 {
		t.Errorf("expected empty list, got %v", apps)
	}
}

func TestDelete(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	if err := store.Save("todelete", &AppState{App: "todelete"}); err != nil {
		t.Fatal(err)
	}

	if err := store.Delete("todelete"); err != nil {
		t.Fatal(err)
	}

	// Verify file is gone.
	_, err := os.Stat(filepath.Join(dir, "todelete.json"))
	if !os.IsNotExist(err) {
		t.Error("state file still exists after Delete")
	}

	// Deleting again should not error.
	if err := store.Delete("todelete"); err != nil {
		t.Errorf("second Delete returned error: %v", err)
	}
}

func TestSaveSetsSchemaVersion(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	st := &AppState{App: "versiontest"}
	// SchemaVersion is 0 before save.
	if st.SchemaVersion != 0 {
		t.Fatalf("expected SchemaVersion 0 before save, got %d", st.SchemaVersion)
	}

	if err := store.Save("versiontest", st); err != nil {
		t.Fatal(err)
	}

	// After save, the struct should have the version set.
	if st.SchemaVersion != CurrentSchemaVersion {
		t.Errorf("SchemaVersion = %d after Save, want %d", st.SchemaVersion, CurrentSchemaVersion)
	}

	// Verify it's persisted correctly.
	loaded, err := store.Load("versiontest")
	if err != nil {
		t.Fatal(err)
	}
	if loaded.SchemaVersion != CurrentSchemaVersion {
		t.Errorf("loaded SchemaVersion = %d, want %d", loaded.SchemaVersion, CurrentSchemaVersion)
	}
}
