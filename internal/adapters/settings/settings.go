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
	"fmt"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/services/kvstore"
)

// Store is Mill's own persistence interface. *kvstore.KVStoreService
// satisfies it structurally -- no wrapper type needed.
type Store interface {
	Get(key string) any
	Set(key string, value any) error
}

// New wraps Wails3's own KVStoreService, JSON-file-backed at filename with
// AutoSave enabled (every Set writes to disk immediately, so callers never
// need an explicit Save/shutdown hook), and loads any existing file before
// returning -- callers get a ready-to-use store, not a two-step
// construct-then-Load API. Ensures filename's parent directory exists
// first: KVStoreService's own Save doesn't create it, and on a fresh
// install it won't exist yet. A missing file is not an error (first run);
// Load only fails on a genuinely corrupt/unreadable file.
func New(filename string) (*kvstore.KVStoreService, error) {
	if err := os.MkdirAll(filepath.Dir(filename), 0o750); err != nil {
		return nil, fmt.Errorf("creating settings directory: %w", err)
	}
	store := kvstore.NewWithConfig(&kvstore.Config{
		Filename: filename,
		AutoSave: true,
	})
	if err := store.Load(); err != nil {
		return nil, fmt.Errorf("loading settings: %w", err)
	}
	return store, nil
}
