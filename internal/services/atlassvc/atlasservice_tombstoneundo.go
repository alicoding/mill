package atlassvc

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// UndoDelete and its own restore/purge helpers -- split out of
// atlasservice_tombstone.go (CLAUDE.md's 500-line file cap) at the
// natural seam between the three delete doors and their shared undo/
// purge machinery.

// UndoDelete reverses one or more DeleteCard/DeleteNote/
// DeleteBoardObject calls: clears DeletedAt on exactly the ids named (a
// no-op for any id that's no longer tombstoned, e.g. already purged)
// and clears a built-in card's or board object's seed tombstone too, so
// top-up seeding can reach it again. cardIDs/noteIDs/objectIDs are the
// exact TombstoneResult(s) the original delete call(s) returned.
func (a *AtlasService) UndoDelete(cardIDs []string, noteIDs []string, objectIDs []string) error {
	a.mu.Lock()
	previousCards := append([]atlas.Card(nil), a.cards...)
	previousNotes := append([]atlas.Note(nil), a.notes...)
	previousObjects := append([]atlas.BoardObject(nil), a.objects...)

	clearedBuiltInIDs := a.restoreCardTombstonesLocked(cardIDs)
	restoreTombstonesLocked(a.notes, noteIDs, a.findNoteLocked,
		func(n atlas.Note) time.Time { return n.DeletedAt },
		func(n *atlas.Note, t time.Time) { n.DeletedAt = time.Time{}; n.UpdatedAt = t })
	clearedBuiltInIDs = append(clearedBuiltInIDs, a.restoreObjectTombstonesLocked(objectIDs)...)

	perr := a.persistLocked()
	if perr != nil {
		a.cards = previousCards
		a.notes = previousNotes
		a.objects = previousObjects
	}
	a.mu.Unlock()
	if perr != nil {
		return fmt.Errorf("save undo delete: %w", perr)
	}
	for _, id := range clearedBuiltInIDs {
		if err := seeding.ClearTombstone(a.store, id); err != nil {
			slog.Error("failed to clear seed tombstone on undo delete", "id", id, "error", err)
		}
	}
	emitUndoDeleteEvents(cardIDs, noteIDs, objectIDs)
	return nil
}

// restoreCardTombstonesLocked is UndoDelete's own card half: same
// shape as restoreTombstonesLocked, plus the built-in-seed bookkeeping
// only a card carries -- returns the ids that need their seed
// tombstone cleared too (so top-up seeding can reach them again).
// Caller must already hold a.mu.
func (a *AtlasService) restoreCardTombstonesLocked(cardIDs []string) []string {
	var clearedBuiltInIDs []string
	now := time.Now()
	for _, id := range cardIDs {
		idx := a.findCardLocked(id)
		if idx == -1 || a.cards[idx].DeletedAt.IsZero() {
			continue
		}
		a.cards[idx].DeletedAt = time.Time{}
		a.cards[idx].UpdatedAt = now
		if a.cards[idx].BuiltIn {
			clearedBuiltInIDs = append(clearedBuiltInIDs, id)
		}
	}
	return clearedBuiltInIDs
}

// restoreObjectTombstonesLocked is restoreCardTombstonesLocked's own
// board-object twin (goal 0223 gives BoardObject the same seed
// provenance Card already carries). Caller must already hold a.mu.
func (a *AtlasService) restoreObjectTombstonesLocked(objectIDs []string) []string {
	var clearedBuiltInIDs []string
	now := time.Now()
	for _, id := range objectIDs {
		idx := a.findObjectLocked(id)
		if idx == -1 || a.objects[idx].DeletedAt.IsZero() {
			continue
		}
		a.objects[idx].DeletedAt = time.Time{}
		a.objects[idx].UpdatedAt = now
		if a.objects[idx].BuiltIn {
			clearedBuiltInIDs = append(clearedBuiltInIDs, id)
		}
	}
	return clearedBuiltInIDs
}

// emitUndoDeleteEvents fires the live-sync event for every restored id
// across all three entity families, in one place.
func emitUndoDeleteEvents(cardIDs, noteIDs, objectIDs []string) {
	for _, id := range cardIDs {
		dataevent.Emit("atlas", id)
	}
	for _, id := range noteIDs {
		dataevent.Emit("atlas", id)
	}
	for _, id := range objectIDs {
		dataevent.Emit("atlas", id)
	}
}

