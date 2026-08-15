package compositionsvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// UpdateNotes replaces a workflow's canvas Notes in place -- the same
// shape as UpdateAttributes (compositionservice.go) already established
// for a workflow-scoped collection saved independently of Nodes/Edges,
// since a note is authoring-space annotation, not a step (docs/goals/0055).
// No graph re-validation is needed: Notes carry no reference
// ValidateGraph could ever break. Split into its own file per the
// 500-line convention (.claude/rules/architecture.md), the same
// per-concern split compositionservice_versioning.go/
// compositionservice_export.go already follow.
func (c *CompositionService) UpdateNotes(workflowID string, notes []composition.Note) (composition.Workflow, error) {
	c.mu.Lock()
	idx := -1
	for i, wf := range c.user {
		if wf.ID == workflowID {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return composition.Workflow{}, fmt.Errorf("no workflow with id %q", workflowID)
	}

	previous := c.user[idx]
	c.user[idx].Notes = notes
	c.user[idx].UpdatedAt = time.Now()
	// Modified latch (docs/goals/0037 item 2) -- same reasoning as
	// UpdateAttributes' own Seed.Touch() call.
	c.user[idx].Seed = c.user[idx].Seed.Touch()
	wf := c.user[idx]
	c.mu.Unlock()

	if err := c.persist(); err != nil {
		c.mu.Lock()
		c.restoreByIDLocked(workflowID, previous)
		c.mu.Unlock()
		return composition.Workflow{}, fmt.Errorf("save workflow notes: %w", err)
	}
	dataevent.Emit("workflow", wf.ID) // goal 0017: live-sync every open surface
	return wf, nil
}
