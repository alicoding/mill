// Package settings wraps Wails3's own built-in KVStoreService behind
// Mill's own names, per CLAUDE.md's ports/adapters rule for commodity
// libraries: persistence is a generic storage concern (like clipboard I/O
// or HTML-to-Markdown conversion, see internal/adapters/clipboard and
// internal/adapters/markdown), not Mill's core domain, so it's bought via
// a well-vetted library rather than hand-rolled. Callers depend on the
// small Store interface below, not the concrete KVStoreService type, so
// swapping the underlying mechanism later never touches domain/service
// code (docs/SPEC.md §2.2).
package settings

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/services/kvstore"
)

type Store interface {
	Get(key string) any
	Set(key string, value any) error
}

// FileStore serializes autosaves with detached snapshots of the same file.
type FileStore struct {
	mu        sync.Mutex
	store     *kvstore.KVStoreService
	filename  string
	persisted bool
}

func (s *FileStore) Get(key string) any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.store.Get(key)
}

func (s *FileStore) Set(key string, value any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.store.Set(key, value); err != nil {
		return err
	}
	s.persisted = true
	return nil
}

// Snapshot returns validated, detached bytes from the persisted settings file.
func (s *FileStore) Snapshot() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, err := os.ReadFile(s.filename) // #nosec G304 -- the adapter's configured settings path
	if err != nil {
		if os.IsNotExist(err) {
			if !s.persisted {
				return []byte("{}"), nil
			}
			return nil, fmt.Errorf("snapshot settings: persisted file is missing")
		}
		return nil, fmt.Errorf("snapshot settings: %w", err)
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return nil, fmt.Errorf("snapshot settings: file is not a JSON object")
	}
	return append([]byte(nil), raw...), nil
}

// New wraps Wails3's own KVStoreService, JSON-file-backed at filename with
// AutoSave enabled (every Set writes to disk immediately, so callers never
// need an explicit Save/shutdown hook), and loads any existing file before
// returning -- callers get a ready-to-use store, not a two-step
// construct-then-Load API. Ensures filename's parent directory exists
// first: KVStoreService's own Save doesn't create it, and on a fresh
// install it won't exist yet. A missing file is not an error (first run);
// Load only fails on a genuinely corrupt/unreadable file.
func New(filename string) (*FileStore, error) {
	if err := os.MkdirAll(filepath.Dir(filename), 0o750); err != nil {
		return nil, fmt.Errorf("creating settings directory: %w", err)
	}
	_, statErr := os.Stat(filename)
	persisted := statErr == nil
	if statErr != nil && !os.IsNotExist(statErr) {
		return nil, fmt.Errorf("inspect settings: %w", statErr)
	}
	store := kvstore.NewWithConfig(&kvstore.Config{
		Filename: filename,
		AutoSave: true,
	})
	if err := store.Load(); err != nil {
		return nil, fmt.Errorf("loading settings: %w", err)
	}
	return &FileStore{store: store, filename: filename, persisted: persisted}, nil
}
