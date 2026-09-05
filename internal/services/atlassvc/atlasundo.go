package atlassvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// ADR-0044's actor-scoped undo journal: one in-memory journal per
// actor, capped at maxUndoMarks marks, lost on restart (the 48h
// tombstone window covers post-restart delete recovery independently).
// Undo/redo apply the inverse as a NEW operation through the SAME
// mutation door every direct call already uses -- never a state
// rollback -- so every door's own recordUndo call is the only thing
// that changes; the door's existing lock/persist/emit body is
// untouched.
//
// Actor identity: the S0 finding (goal 0219) is that NO session/actor
// parameter exists anywhere at the AtlasService seam -- Wails-bound UI
// calls and MCP-approved writes (executeAtlasCreateCard/
// executeAtlasUpdateCard, atlasundo_mcp.go) invoke the exact same Go
// methods with zero distinguishing context. Rather than inventing a
// session-identity system the ADR explicitly forbids, v1 scopes the UI
// actor to one app-wide bucket (actorUI) -- correct for today's single-
// window desktop app -- and gives the MCP/workflow write paths their
// own dedicated entry points (CreateCardForMCP etc., CreateCardForWorkflow
// already existed) that record under a SEPARATE actor tag never popped
// by Undo()/Redo(). This is a purely static, call-site distinction (no
// shared mutable "current actor" flag), so it carries no data-race risk.

// undoActor identifies which stack an entry belongs to. Only actorUI is
// ever popped by Undo()/Redo(); the others exist so every door's
// journal call is uniform (ADR-0044 consequence: "every mutation door
// pays one journal-record call at its existing seam") and so an
// MCP/workflow write still leaves an audit trail, without ever being
// reachable from a UI actor's ⌘Z.
type undoActor string

const (
	actorUI       undoActor = "ui"
	actorMCP      undoActor = "mcp"
	actorWorkflow undoActor = "workflow"
)

// maxUndoMarks caps how many marks (not entries) an actor's undo stack
// holds -- ADR-0044 decision 6. A mark can hold many entries (a
// multi-select delete, an eraser stroke), so this bounds "how many
// distinct undo steps," not raw entry count.
const maxUndoMarks = 100

// undoEntry is one journal record (ADR-0044 decision 1). undoApply and
// redoApply are built ONCE, at record time, from the exact before/after
// values the recording door already computed -- not reconstructed by
// replaying through the generic recording path -- so applying either
// closure needs no ambient "which direction is this" state and carries
// no re-entrancy risk. label is a short, human-facing name for the
// entity (a card's title, a shape's kind) used only in the apply-time
// skip notice.
type undoEntry struct {
	markID     int
	entityKind string
	entityID   string
	label      string
	undoApply  func(a *AtlasService) error
	redoApply  func(a *AtlasService) error
}

// UndoResult is Undo/Redo's own RPC return -- the frontend renders
// Message directly rather than Mill routing an apply-time skip through
// a separate notice surface (goal 0122's notice store is scoped to
// update-checking today; a short, synchronous RPC result is simpler
// than generalizing it for one more caller in this slice).
type UndoResult struct {
	// Applied is true when a mark was popped and at least attempted --
	// false only when the stack was already empty (nothing to do).
	Applied bool
	// Skipped is true when one or more entries in the mark could not be
	// applied because their target changed since (ADR-0044 decision 5).
	Skipped bool
	Message string
}

// recordUndo appends one entry to actor's undo stack, grouped into the
// currently open mark (BeginUndoMark/EndUndoMark) or a fresh one-entry
// mark otherwise (ADR-0044 decision 2: "non-gesture doors are one
// implicit mark per service call"). A new entry always clears actor's
// redo stack (standard undo/redo semantics: a fresh action invalidates
// whatever was available to redo). Called UNLOCKED (same placement as
// dataevent.Emit in every door) -- takes a.mu itself for its own brief
// critical section. Suppressed entirely while a.suppressRecording is
// set: that's Undo()/Redo() replaying a PREVIOUSLY recorded entry's
// closure through the same public door, which must not mint a second,
// redundant entry (the closure pair built at ORIGINAL record time IS
// the redo/undo counterpart already).
func (a *AtlasService) recordUndo(actor undoActor, kind, id, label string, undoApply, redoApply func(a *AtlasService) error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.suppressRecording {
		return
	}
	markID := a.openMarkID
	if markID == 0 {
		a.undoMarkSeq++
		markID = a.undoMarkSeq
	}
	entry := undoEntry{markID: markID, entityKind: kind, entityID: id, label: label, undoApply: undoApply, redoApply: redoApply}
	if a.undoStacks == nil {
		a.undoStacks = map[undoActor][]undoEntry{}
	}
	if a.redoStacks == nil {
		a.redoStacks = map[undoActor][]undoEntry{}
	}
	a.undoStacks[actor] = capMarks(append(a.undoStacks[actor], entry), maxUndoMarks)
	a.redoStacks[actor] = nil
}

// capMarks drops the OLDEST marks once actor's stack holds more than
// max distinct marks -- entries within a kept mark are never split.
func capMarks(stack []undoEntry, max int) []undoEntry {
	if len(stack) == 0 {
		return stack
	}
	marks := 1
	cut := 0
	for i := len(stack) - 1; i > 0; i-- {
		if stack[i].markID != stack[i-1].markID {
			marks++
			if marks > max {
				cut = i
				break
			}
		}
	}
	if cut == 0 {
		return stack
	}
	return append([]undoEntry(nil), stack[cut:]...)
}

// recordScalar is the shared shape every set-scalar/update-content door
// uses (ADR-0044's scalar/content families): undo re-applies previous
// through the SAME setter method; redo re-applies next the same way.
// Generic over the value type so every setter (Position, Dimensions,
// float64 rotation degrees, string fields...) shares one recording call
// instead of hand-rolling a closure pair per door.
func recordScalar[T any](a *AtlasService, actor undoActor, kind, id, label string, apply func(a *AtlasService, v T) error, previous, next T) {
	a.recordUndo(actor, kind, id, label,
		func(a *AtlasService) error { return apply(a, previous) },
		func(a *AtlasService) error { return apply(a, next) },
	)
}

// recordSizeChange is the shared undo-recording shape every
// size-setting door uses (card/note/board object, goal 0273 defect
// class): previous/next are *Dimensions, nil meaning "unsized" (the
// entity's natural/intrinsic footprint), so undoing a first-ever
// resize replays through clear -- restoring nil -- rather than
// synthesizing a zero Dimensions{} box through the door's own
// floor-guarded setter, which would refuse it as a degenerate size.
func recordSizeChange(a *AtlasService, kind, id, label string, previous, next *atlas.Dimensions, set func(a *AtlasService, sz atlas.Dimensions) error, clear func(a *AtlasService) error) {
	recordScalar(a, actorUI, kind, id, label,
		func(a *AtlasService, sz *atlas.Dimensions) error {
			if sz == nil {
				return clear(a)
			}
			return set(a, *sz)
		},
		previous, next,
	)
}

// BeginUndoMark/EndUndoMark let the frontend group several door calls
// made within one user gesture into ONE undo step (ADR-0044 decision 2
// -- "everything inside one mark undoes atomically"): the 0215 gesture
// engine's own start/end boundaries, and a multi-select group action
// (delete, paste-landing). Nested calls are supported (depth-counted)
// so a helper that itself opens/closes a mark can be called from inside
// an already-open one without splitting it. A door called with no mark
// open gets its own one-entry mark automatically (recordUndo's
// markID == 0 branch) -- most doors never need these at all.
func (a *AtlasService) BeginUndoMark() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.openMarkDepth == 0 {
		a.undoMarkSeq++
		a.openMarkID = a.undoMarkSeq
	}
	a.openMarkDepth++
}

func (a *AtlasService) EndUndoMark() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.openMarkDepth > 0 {
		a.openMarkDepth--
	}
	if a.openMarkDepth == 0 {
		a.openMarkID = 0
	}
}

// UndoState reports whether ⌘Z/⇧⌘Z currently have anything to do --
// polled by the frontend after every atlas dataevent so the keyboard
// listener can decide, without a round trip, whether to preventDefault
// (goal 0093's editable-field guard needs this to stay a synchronous
// decision).
type UndoState struct {
	HasUndo bool
	HasRedo bool
}

func (a *AtlasService) UndoState() UndoState {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return UndoState{
		HasUndo: len(a.undoStacks[actorUI]) > 0,
		HasRedo: len(a.redoStacks[actorUI]) > 0,
	}
}

func (a *AtlasService) setSuppressRecording(v bool) {
	a.mu.Lock()
	a.suppressRecording = v
	a.mu.Unlock()
}

// skipMessage renders ADR-0044 decision 5's apply-time staleness notice
// -- ux-writing.md: front-loaded outcome, one sentence, no internals.
func skipMessage(label string) string {
	if label == "" {
		return "Can't undo that step — it changed elsewhere."
	}
	return fmt.Sprintf("Can't undo %q — it changed elsewhere.", label)
}
