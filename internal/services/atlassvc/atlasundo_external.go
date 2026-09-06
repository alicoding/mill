package atlassvc

import "time"

// ADR-0044's law is ONE actor-scoped journal behind every board
// mutation door, never a per-widget stack. A board table's cells are
// rows of a Configure List, so the write that fills one leaves this
// package entirely (ConfigureService.UpdateListRow) -- without the
// seam below, ⌘Z right after typing in a cell reached past the edit to
// the table's own CREATE entry and deleted the table (goal 0352).
// RecordExternalUndo is that seam: a mutation door in ANOTHER service
// records into the SAME actorUI journal, in order, so one history
// covers the board and Configure's List page alike. The recording door
// owns its own inverse (it alone knows how to write its entity back);
// this package owns the ordering, the marks, and the replay.
//
// undoCoalesceWindow: consecutive entries carrying the same non-empty
// coalesceKey fold into ONE journal entry when the newer one arrives
// within this window of the older. The folded entry keeps the FIRST
// undo (the value as it stood before the editing session) and takes
// the LATEST redo, so retyping one cell three times is one ⌘Z, not
// three, and ⇧⌘Z returns the value the user last committed.
const undoCoalesceWindow = 2 * time.Second

// RecordExternalUndo journals one mutation made by a door outside this
// service, under the UI actor -- the only actor ⌘Z pops. undo and redo
// are the recording door's own inverse pair, built at record time from
// the before/after values it already computed; both are called with
// a.suppressRecording held, so the door they write through skips
// minting a redundant entry exactly as an in-package door does. An
// inverse that errors (its row deleted, its column removed) is skipped
// with ADR-0044 decision 5's notice, label naming the entity.
//
// coalesceKey: non-empty folds consecutive edits to the same target
// (see undoCoalesceWindow); empty records one entry per call.
//
//wails:ignore
func (a *AtlasService) RecordExternalUndo(kind, id, label, coalesceKey string, undo, redo func() error) {
	if undo == nil || redo == nil {
		return
	}
	a.appendUndoEntry(actorUI, undoEntry{
		entityKind:  kind,
		entityID:    id,
		label:       label,
		coalesceKey: coalesceKey,
		undoApply:   func(*AtlasService) error { return undo() },
		redoApply:   func(*AtlasService) error { return redo() },
	})
}

// foldIntoTopLocked folds entry into actor's topmost entry when both
// carry the same non-empty coalesceKey and the top was recorded less
// than undoCoalesceWindow ago, reporting whether it did. Caller holds
// a.mu (appendUndoEntry's own critical section). Folding advances the
// redo closure and the window's clock while keeping the top entry's
// mark and its ORIGINAL undo closure; a fold, like a fresh entry,
// invalidates the redo stack.
func (a *AtlasService) foldIntoTopLocked(actor undoActor, entry undoEntry) bool {
	if entry.coalesceKey == "" {
		return false
	}
	stack := a.undoStacks[actor]
	if len(stack) == 0 {
		return false
	}
	top := &stack[len(stack)-1]
	if top.coalesceKey != entry.coalesceKey || time.Since(top.recordedAt) >= undoCoalesceWindow {
		return false
	}
	top.redoApply = entry.redoApply
	top.recordedAt = time.Now()
	a.redoStacks[actor] = nil
	return true
}
