// Package entitystore is the generic Create/Update/Delete/List/
// persist machinery shared by every Configure entity kind
// (HTTPRequest, Decision, List, MCPServer, ExecEnv, AIProvider,
// DeclaredStepType) -- goal 0165, replacing ~10 hand-copied methods
// per kind with one small Descriptor. Every function here takes the
// owning service's existing *sync.Mutex and *[]T field directly,
// never a lock of its own -- ConfigureService's lock granularity
// (one mutex for the whole service) and its one-JSON-blob-per-kind
// persistence shape are both unchanged; only the mechanically
// identical bodies collapse. See entitystore_seed.go for the
// insert/upgrade/leave-alone/skip reconcile family (docs/goals/0037)
// and entitystore_import.go for the update-or-create import dispatch.
package entitystore

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// Descriptor is the per-entity-kind shape every generic function in
// this package needs. Kept to closures rather than an interface a
// domain type must implement, so internal/domain/* stays untouched by
// this refactor -- purely a configuresvc-layer concern
// (.claude/rules/backend.md's domain-purity rule).
type Descriptor[T any] struct {
	// Label names the entity kind in error messages ("execution
	// environment", "decision", "MCP server", ...) -- every generic
	// message here mirrors the exact wording each hand-written method
	// used before this refactor ("no %s with id %q", "save %s: %w"),
	// and plurals by simple "+s" suffix (holds for every kind this
	// package serves; a kind whose plural doesn't form that way would
	// need its own Descriptor field, not a change to this package).
	Label string
	GetID func(T) string

	// IsBuiltIn reports whether an entity was seeded, not user-
	// created -- gates the tombstone-on-delete behavior (docs/
	// goals/0025 item 2).
	IsBuiltIn func(T) bool

	// GetSeed/SetSeed read/write the seed-provenance latch
	// (docs/goals/0037) -- SetSeed returns a copy, never mutates in
	// place.
	GetSeed func(T) seedorigin.Origin
	SetSeed func(T, seedorigin.Origin) T

	// StampNew returns a copy of golden with CreatedAt/UpdatedAt set
	// to now -- used both for a fresh reconcile-insert and for
	// Restore, mirroring every hand-written reconcile/RestoreX's own
	// `golden.CreatedAt, golden.UpdatedAt = now, now`.
	StampNew func(golden T, now time.Time) T

	// Upgrade replaces existing's content with golden's while
	// preserving existing's identity (ID/CreatedAt) and stamping a
	// fresh Seed -- each entity's own upgradeXToGolden function
	// (unchanged by this refactor, just wired in here), reused by
	// both the reconcile upgrade branch and ResetToSeed.
	Upgrade func(existing, golden T, now time.Time) T

	// BuiltIn returns the currently-shipped goldens for this kind.
	BuiltIn func() []T
}

// find returns the index of the entity with id, or -1.
func find[T any](items []T, id string, getID func(T) string) int {
	for i, it := range items {
		if getID(it) == id {
			return i
		}
	}
	return -1
}

// findGolden returns a copy of the golden with id, if one exists
// among d.BuiltIn() -- the shared lookup every reset/restore path
// needs before it can act.
func findGolden[T any](d Descriptor[T], id string) (T, bool) {
	for _, g := range d.BuiltIn() {
		if d.GetID(g) == id {
			return g, true
		}
	}
	var zero T
	return zero, false
}

// insertAt reinserts v at idx (clamped to the current length) --
// every hand-written DeleteX's own undo path for a tombstone/persist
// failure, collapsed into one generic helper.
func insertAt[T any](items []T, idx int, v T) []T {
	if idx < 0 || idx > len(items) {
		idx = len(items)
	}
	var zero T
	items = append(items, zero)
	copy(items[idx+1:], items[idx:])
	items[idx] = v
	return items
}

// Insert appends v under mu and persists it; on persist failure v is
// removed again so no phantom entry survives a failed save
// (docs/goals/0025 item 2's memory-vs-store rule).
func Insert[T any](mu *sync.Mutex, items *[]T, persist func() error, d Descriptor[T], v T) error {
	mu.Lock()
	*items = append(*items, v)
	mu.Unlock()

	if err := persist(); err != nil {
		mu.Lock()
		if idx := find(*items, d.GetID(v), d.GetID); idx != -1 {
			*items = append((*items)[:idx], (*items)[idx+1:]...)
		}
		mu.Unlock()
		return fmt.Errorf("save %s: %w", d.Label, err)
	}
	return nil
}

// Update finds id and, while still holding mu, applies mutate to a
// copy of the existing value -- the whole find-mutate-replace step is
// atomic, matching every hand-written UpdateX this replaces (mutate
// carries whatever entity-specific validation/immutability rule that
// UpdateX had, e.g. Decision's category-change refusal). On persist
// failure the previous value is restored in memory.
func Update[T any](mu *sync.Mutex, items *[]T, persist func() error, d Descriptor[T], id string, mutate func(existing T) (T, error)) (T, error) {
	mu.Lock()
	idx := find(*items, id, d.GetID)
	if idx == -1 {
		mu.Unlock()
		var zero T
		return zero, fmt.Errorf("no %s with id %q", d.Label, id)
	}
	previous := (*items)[idx]
	updated, err := mutate(previous)
	if err != nil {
		mu.Unlock()
		var zero T
		return zero, err
	}
	(*items)[idx] = updated
	mu.Unlock()

	if err := persist(); err != nil {
		mu.Lock()
		if idx := find(*items, id, d.GetID); idx != -1 {
			(*items)[idx] = previous
		}
		mu.Unlock()
		var zero T
		return zero, fmt.Errorf("save %s: %w", d.Label, err)
	}
	return updated, nil
}

// DeleteWithTombstone removes id under mu, tombstoning it first when
// it was a built-in (so top-up seeding never resurrects a user's
// deliberate delete, docs/goals/0025 item 2), then persists -- any
// failure along the way reinserts the removed value at its original
// index. Callers run their own reference-integrity check before
// calling this (refIntegrityError), since that check's message names
// the referencing workflow and isn't part of the generic shape.
func DeleteWithTombstone[T any](mu *sync.Mutex, items *[]T, persist func() error, recordTombstone func(id string) error, d Descriptor[T], id string) error {
	mu.Lock()
	idx := find(*items, id, d.GetID)
	if idx == -1 {
		mu.Unlock()
		return fmt.Errorf("no %s with id %q", d.Label, id)
	}
	removed := (*items)[idx]
	wasBuiltIn := d.IsBuiltIn(removed)
	*items = append((*items)[:idx], (*items)[idx+1:]...)
	mu.Unlock()

	if wasBuiltIn {
		if err := recordTombstone(id); err != nil {
			mu.Lock()
			*items = insertAt(*items, idx, removed)
			mu.Unlock()
			return fmt.Errorf("tombstone deleted %s %q: %w", d.Label, id, err)
		}
	}
	if err := persist(); err != nil {
		mu.Lock()
		*items = insertAt(*items, idx, removed)
		mu.Unlock()
		return fmt.Errorf("save %s deletion: %w", d.Label, err)
	}
	return nil
}

// Persist marshals a snapshot of *items to JSON and writes it to
// store under key -- every hand-written persistX's own body.
func Persist[T any](mu *sync.Mutex, items *[]T, store settings.Store, key string, d Descriptor[T]) error {
	mu.Lock()
	snapshot := make([]T, len(*items))
	copy(snapshot, *items)
	mu.Unlock()

	data, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("marshal %ss: %w", d.Label, err)
	}
	if err := store.Set(key, string(data)); err != nil {
		return fmt.Errorf("persist %ss: %w", d.Label, err)
	}
	return nil
}

// Load reads key's JSON blob from store and replaces *items wholesale
// -- every hand-written restoreX's own body. A missing/empty/
// unparseable value leaves *items untouched, same silent-noop
// original behavior (an entity kind's very first launch has nothing
// to load yet; ConfigureService's own restore() seeds it separately).
func Load[T any](mu *sync.Mutex, items *[]T, store settings.Store, key string) {
	raw, ok := store.Get(key).(string)
	if !ok || raw == "" {
		return
	}
	var loaded []T
	if err := json.Unmarshal([]byte(raw), &loaded); err != nil {
		return
	}
	mu.Lock()
	*items = loaded
	mu.Unlock()
}
