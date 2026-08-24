package atlassvc

import (
	"fmt"
	"time"
)

// This file is the board-local entities' shared mutation plumbing
// (goal 0179/0180): Note and BoardObject are two independent families
// whose reparent/soft-delete methods reduce to the IDENTICAL shape
// (find by id under a.mu, mutate one field, persist, roll back on a
// persist failure) -- confirmed by dupl's own 150-token gate flagging
// MoveNote/MoveBoardObject and DeleteNote/DeleteBoardObject as clones
// of each other. Extracted here once, generically, so a THIRD
// board-local kind (0169 S5's shape, say) reuses this plumbing rather
// than cloning it again -- the goal's own "a third noun costs a
// declaration, not a new hand-built entity" point, proven at the
// service layer, not just the domain type.

// reparentEntityLocked validates newParentID names an existing card
// (or is "", meaning root), then reparents the element at idx in
// slice, persists, and rolls back on a persist failure. Caller must
// already hold a.mu. touch stores newParentID and the current time
// onto the element in place; noun names the entity in error messages
// only ("no card with id %q to contain this NOUN").
func reparentEntityLocked[T any](a *AtlasService, slice []T, idx int, newParentID, noun string, touch func(*T, string, time.Time)) (T, error) {
	var zero T
	if newParentID != "" && a.findCardLocked(newParentID) == -1 {
		return zero, fmt.Errorf("no card with id %q to contain this %s", newParentID, noun)
	}
	previous := slice[idx]
	next := previous
	touch(&next, newParentID, time.Now())
	slice[idx] = next
	if err := a.persistLocked(); err != nil {
		slice[idx] = previous
		return zero, fmt.Errorf("save %s move: %w", noun, err)
	}
	return next, nil
}

// restoreTombstonesLocked clears DeletedAt (and bumps UpdatedAt) on
// every id in ids that is CURRENTLY tombstoned in slice -- a no-op for
// any id no longer tombstoned (already purged, or a stale id). The
// shared "undo one soft-delete" shape UndoDelete runs identically
// across notes and board objects (cards keep their own loop, for the
// extra built-in-seed bookkeeping DeleteCard alone carries). Caller
// must already hold a.mu.
func restoreTombstonesLocked[T any](slice []T, ids []string, findIdx func(id string) int, deletedAt func(T) time.Time, clear func(*T, time.Time)) {
	now := time.Now()
	for _, id := range ids {
		idx := findIdx(id)
		if idx == -1 || deletedAt(slice[idx]).IsZero() {
			continue
		}
		clear(&slice[idx], now)
	}
}

// softDeleteEntityLocked resolves id via findIdx, tombstones it (a
// no-op-turned-error if already tombstoned), persists, and rolls back
// on a persist failure. Caller must already hold a.mu. markDeleted
// stamps DeletedAt/UpdatedAt onto the element in place; noun names the
// entity in error messages only.
func softDeleteEntityLocked[T any](a *AtlasService, slice []T, id, noun string, findIdx func() int, deletedAt func(T) time.Time, markDeleted func(*T, time.Time)) error {
	idx := findIdx()
	if idx == -1 {
		return fmt.Errorf("no %s with id %q", noun, id)
	}
	if !deletedAt(slice[idx]).IsZero() {
		return fmt.Errorf("%s %q is already deleted", noun, id)
	}
	previous := slice[idx]
	markDeleted(&slice[idx], time.Now())
	if err := a.persistLocked(); err != nil {
		slice[idx] = previous
		return fmt.Errorf("save %s deletion: %w", noun, err)
	}
	return nil
}
