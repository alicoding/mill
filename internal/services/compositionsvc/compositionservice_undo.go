package compositionsvc

import (
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// A workflow delete is a step on the app's ONE actor-scoped undo
// journal (ADR-0044, goal 0404 S1), the same journal Configure entity
// deletes and List row edits already sit on -- so a bulk delete over
// several workflows (shared/bulkDeleteWithUndo.ts wrapping this door in
// one BeginUndoMark/EndUndoMark) restores with one ⌘Z, matching every
// other family. One entry family:
//
//   - workflow {id, record} -- a whole workflow deleted. The record
//     (nodes, edges, attributes, lifecycle state) rides inside the
//     restore closure, captured at delete time by DeleteWorkflow, so
//     undo puts back exactly what was there; redo deletes again
//     through the same door.

// undoRecorder is the journal's record call, injected once at the
// composition root (WireUndoJournal) -- the identical shape
// configuresvc's own seam uses (RecordExternalUndo's signature), so a
// workflow delete joins the same actor-scoped journal Configure
// entities and List rows already sit on. Nil, and DeleteWorkflow simply
// registers no way back -- a test or headless build that never wires a
// board.
type undoRecorder func(kind, id, label, coalesceKey string, undo, redo func() error)

// WireUndoJournal connects DeleteWorkflow to the app's actor-scoped
// undo journal. Exported for wiring only, never a frontend RPC.
//
//wails:ignore
func (c *CompositionService) WireUndoJournal(record undoRecorder) {
	c.recordUndo = record
}

// registerWorkflowDelete gives one workflow delete both ways back
// (goal 0404 S1): the journal's own "workflow" entry restores the
// record whole -- nodes, edges, attributes -- at its original index,
// and redo deletes again through DeleteWorkflow itself (suppressed
// recording during replay means the redo mints no second entry).
func (c *CompositionService) registerWorkflowDelete(id, label string, removed composition.Workflow, idx int, wasBuiltIn bool) {
	if c.recordUndo == nil {
		return
	}
	restore := func() error {
		c.mu.Lock()
		c.insertAtLocked(idx, removed)
		c.mu.Unlock()
		if wasBuiltIn {
			if err := seeding.ClearTombstone(c.store, id); err != nil {
				return err
			}
		}
		if err := c.persist(); err != nil {
			return err
		}
		c.notifySyncer()
		dataevent.Emit("workflow", id)
		return nil
	}
	c.recordUndo("workflow", id, label, "", restore, func() error { return c.DeleteWorkflow(id) })
}
