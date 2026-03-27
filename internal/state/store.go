package state

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Store manages state files in a directory.
type Store struct {
	dir string
}

// NewStore creates a Store that reads and writes state files in dir.
func NewStore(dir string) *Store {
	return &Store{dir: dir}
}

// Load reads the state file for the given app. If the file does not exist,
// it returns a zero-value AppState (not an error). It refuses to load state
// files with a schema_version newer than CurrentSchemaVersion.
func (s *Store) Load(app string) (*AppState, error) {
	path := s.path(app)
	data, err := os.ReadFile(path) //nolint:gosec // path constructed from trusted app name
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &AppState{}, nil
		}
		return nil, fmt.Errorf("reading state file %s: %w", path, err)
	}

	var st AppState
	if err := json.Unmarshal(data, &st); err != nil {
		return nil, fmt.Errorf("parsing state file %s: %w", path, err)
	}

	if st.SchemaVersion > CurrentSchemaVersion {
		return nil, fmt.Errorf("state file %s has schema_version %d, but this binary only supports up to %d",
			path, st.SchemaVersion, CurrentSchemaVersion)
	}

	return &st, nil
}

// Save writes the state for the given app atomically. It writes to a temporary
// file in the same directory, then renames it into place (atomic on Linux).
// It sets SchemaVersion to CurrentSchemaVersion before writing.
func (s *Store) Save(app string, state *AppState) error {
	if err := os.MkdirAll(s.dir, 0o750); err != nil {
		return fmt.Errorf("creating state directory: %w", err)
	}

	state.SchemaVersion = CurrentSchemaVersion

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling state: %w", err)
	}
	data = append(data, '\n')

	target := s.path(app)

	tmp, err := os.CreateTemp(s.dir, app+".*.tmp")
	if err != nil {
		return fmt.Errorf("creating temp file: %w", err)
	}
	tmpName := tmp.Name()

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return fmt.Errorf("writing temp file: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return fmt.Errorf("syncing temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("closing temp file: %w", err)
	}

	if err := os.Rename(tmpName, target); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("renaming temp file to %s: %w", target, err)
	}

	return nil
}

// List returns the names of all apps that have state files.
func (s *Store) List() ([]string, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading state directory: %w", err)
	}

	var apps []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasSuffix(name, ".json") {
			apps = append(apps, strings.TrimSuffix(name, ".json"))
		}
	}
	return apps, nil
}

// Delete removes the state file for the given app.
func (s *Store) Delete(app string) error {
	path := s.path(app)
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("removing state file %s: %w", path, err)
	}
	return nil
}

func (s *Store) path(app string) string {
	return filepath.Join(s.dir, app+".json")
}
