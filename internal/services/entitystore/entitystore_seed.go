package entitystore

import (
	"fmt"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/seeding"
)

// Reconcile applies the insert/upgrade/leave-alone/skip algorithm
// (docs/goals/0037) for every golden in d.BuiltIn(): absent and
// untombstoned inserts; present, unmodified, and stale upgrades in
// place; present and Modified is left alone regardless of how far its
// revision has drifted; tombstoned and absent is skipped. An existing
// entry with no SeedOrigin at all (SeedRevision == 0, predates goal
// 0037) is migration-stamped Modified: true rather than silently
// upgraded. Returns the newly-inserted goldens (for a caller's own
// post-insert side effect, e.g. seeding a demo secret) and whether
// anything changed -- callers persist only when changed, same
// fire-and-forget log-on-failure treatment every reconcileBuiltInX
// already used.
func Reconcile[T any](mu *sync.Mutex, items *[]T, tombstones map[string]bool, d Descriptor[T]) (inserted []T, changed bool) {
	now := time.Now()
	mu.Lock()
	defer mu.Unlock()

	byID := make(map[string]int, len(*items))
	for i, it := range *items {
		byID[d.GetID(it)] = i
	}
	for _, golden := range d.BuiltIn() {
		id := d.GetID(golden)
		idx, present := byID[id]
		if !present {
			if tombstones[id] {
				continue
			}
			golden = d.StampNew(golden, now)
			*items = append(*items, golden)
			inserted = append(inserted, golden)
			changed = true
			continue
		}
		existing := (*items)[idx]
		seed := d.GetSeed(existing)
		if seed.SeedRevision == 0 {
			(*items)[idx] = d.SetSeed(existing, seedorigin.Origin{SeedRevision: d.GetSeed(golden).SeedRevision, Modified: true})
			changed = true
			continue
		}
		if seed.Modified {
			continue
		}
		if seed.SeedRevision < d.GetSeed(golden).SeedRevision {
			(*items)[idx] = d.Upgrade(existing, golden, now)
			changed = true
		}
	}
	return inserted, changed
}

// ResetToSeed replaces id's content with the current golden's and
// clears the Modified latch (docs/goals/0037 item 4) -- an explicit,
// on-demand act available regardless of current Modified/revision
// state, unlike Reconcile's own conditional upgrade.
func ResetToSeed[T any](mu *sync.Mutex, items *[]T, persist func() error, d Descriptor[T], id string) (T, error) {
	golden, ok := findGolden(d, id)
	if !ok {
		var zero T
		return zero, fmt.Errorf("no built-in %s with id %q", d.Label, id)
	}
	mu.Lock()
	idx := find(*items, id, d.GetID)
	if idx == -1 {
		mu.Unlock()
		var zero T
		return zero, fmt.Errorf("no %s with id %q", d.Label, id)
	}
	previous := (*items)[idx]
	updated := d.Upgrade(previous, golden, time.Now())
	(*items)[idx] = updated
	mu.Unlock()

	if err := persist(); err != nil {
		mu.Lock()
		(*items)[idx] = previous
		mu.Unlock()
		var zero T
		return zero, fmt.Errorf("save reset %s: %w", d.Label, err)
	}
	return updated, nil
}

// Restorable returns every built-in the user deliberately deleted
// (tombstoned) and hasn't since restored -- the read model for a
// "Restore example…" affordance, shown only when non-empty.
func Restorable[T any](mu *sync.Mutex, items *[]T, tombstones map[string]bool, d Descriptor[T]) []T {
	if len(tombstones) == 0 {
		return nil
	}
	mu.Lock()
	have := make(map[string]bool, len(*items))
	for _, it := range *items {
		have[d.GetID(it)] = true
	}
	mu.Unlock()

	var out []T
	for _, golden := range d.BuiltIn() {
		id := d.GetID(golden)
		if tombstones[id] && !have[id] {
			out = append(out, golden)
		}
	}
	return out
}

// Restore un-tombstones id and re-seeds it (docs/goals/0037 item 5) --
// the reverse of DeleteWithTombstone for a built-in.
func Restore[T any](mu *sync.Mutex, items *[]T, persist func() error, store settings.Store, d Descriptor[T], id string) (T, error) {
	golden, ok := findGolden(d, id)
	if !ok {
		var zero T
		return zero, fmt.Errorf("no built-in %s with id %q", d.Label, id)
	}
	mu.Lock()
	if find(*items, id, d.GetID) != -1 {
		mu.Unlock()
		var zero T
		return zero, fmt.Errorf("%s %q is already present, nothing to restore", d.Label, id)
	}
	mu.Unlock()

	if err := seeding.ClearTombstone(store, id); err != nil {
		var zero T
		return zero, fmt.Errorf("clear tombstone for %q: %w", id, err)
	}
	golden = d.StampNew(golden, time.Now())

	mu.Lock()
	*items = append(*items, golden)
	mu.Unlock()

	if err := persist(); err != nil {
		mu.Lock()
		if idx := find(*items, id, d.GetID); idx != -1 {
			*items = append((*items)[:idx], (*items)[idx+1:]...)
		}
		mu.Unlock()
		var zero T
		return zero, fmt.Errorf("save restored %s: %w", d.Label, err)
	}
	return golden, nil
}
