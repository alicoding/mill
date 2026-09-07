package entitystore

import (
	"fmt"
	"sync"
)

// DeleteRecoverable is DeleteWithTombstone plus the way back (goal
// 0270): it returns a restore func that reinserts the removed value at
// its original index (clamped), clears the seed tombstone a built-in's
// delete recorded, and persists -- and the removed value itself, so a
// caller journaling the delete (ADR-0044's configure-entity entry
// family) has the record it removed without a second lookup. Restore
// refuses when an entity with the same id has since been created; a
// failed persist removes the value again so memory and store never
// disagree.
func DeleteRecoverable[T any](mu *sync.Mutex, items *[]T, persist func() error, recordTombstone, clearTombstone func(id string) error, d Descriptor[T], id string) (func() error, T, error) {
	mu.Lock()
	idx := find(*items, id, d.GetID)
	var removed T
	if idx != -1 {
		removed = (*items)[idx]
	}
	mu.Unlock()
	if err := DeleteWithTombstone(mu, items, persist, recordTombstone, d, id); err != nil {
		var zero T
		return nil, zero, err
	}
	return restorer(mu, items, persist, clearTombstone, d, id, idx, removed, d.IsBuiltIn(removed)), removed, nil
}

// restorer is DeleteRecoverable's way back: reinsert at the original
// index (clamped), clear a built-in's tombstone, persist; a failed
// persist removes the value again so memory and store never disagree.
func restorer[T any](mu *sync.Mutex, items *[]T, persist func() error, clearTombstone func(id string) error, d Descriptor[T], id string, idx int, removed T, wasBuiltIn bool) func() error {
	return func() error {
		mu.Lock()
		if find(*items, id, d.GetID) != -1 {
			mu.Unlock()
			return fmt.Errorf("a %s with id %q already exists", d.Label, id)
		}
		at := min(idx, len(*items))
		*items = insertAt(*items, at, removed)
		mu.Unlock()
		if wasBuiltIn {
			if err := clearTombstone(id); err != nil {
				return fmt.Errorf("clear tombstone of restored %s %q: %w", d.Label, id, err)
			}
		}
		if err := persist(); err != nil {
			mu.Lock()
			if i := find(*items, id, d.GetID); i != -1 {
				*items = append((*items)[:i], (*items)[i+1:]...)
			}
			mu.Unlock()
			return fmt.Errorf("save restored %s: %w", d.Label, err)
		}
		return nil
	}
}
