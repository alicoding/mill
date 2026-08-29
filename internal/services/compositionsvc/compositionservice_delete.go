package compositionsvc

import (
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// The workflow delete path -- removal, the built-in tombstone,
// rollback on persist failure, and the derived-state release hook
// (docs/goals/0250) -- split from compositionservice.go at the
// 500-line convention.

// DeleteWorkflow removes a workflow -- seeded or user-composed, both
// live in c.user (see Workflows' doc comment), no built-in special
// case. Blocked while any OTHER workflow's child-workflow node still
// references id (docs/adr/0040 decision 3, same reference-integrity
// rule ConfigureService's own Delete* methods apply to every other
// RefKind, via WorkflowsReferencing).
func (c *CompositionService) DeleteWorkflow(id string) error {
	if refs := c.WorkflowsReferencing("workflow", id); len(refs) > 0 {
		return fmt.Errorf("workflow %q is still referenced by workflow(s) %s -- remove the reference before deleting it", id, strings.Join(refs, ", "))
	}

	c.mu.Lock()
	idx := -1
	for i, wf := range c.user {
		if wf.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return fmt.Errorf("no workflow with id %q", id)
	}
	removed := c.user[idx]
	wasBuiltIn := removed.BuiltIn
	c.user = append(c.user[:idx], c.user[idx+1:]...)
	c.mu.Unlock()

	// A deleted built-in gets a tombstone so top-up seeding (restore)
	// never resurrects it -- deletion stays permanent (§2.2). Tombstone
	// and removal must succeed together: if the tombstone can't be
	// persisted, leaving the in-memory removal in place would mean the
	// next restart's top-up seeding silently resurrects a workflow the
	// user just deleted (docs/goals/0025 item 2) -- so roll the removal
	// back and fail the whole delete instead.
	if wasBuiltIn {
		if err := seeding.RecordTombstone(c.store, id); err != nil {
			c.mu.Lock()
			c.insertAtLocked(idx, removed)
			c.mu.Unlock()
			return fmt.Errorf("tombstone deleted workflow %q: %w", id, err)
		}
	}
	if err := c.persist(); err != nil {
		c.mu.Lock()
		c.insertAtLocked(idx, removed)
		c.mu.Unlock()
		return fmt.Errorf("save workflow deletion: %w", err)
	}
	c.notifySyncer()
	if c.onDeleted != nil {
		c.onDeleted(id)
	}
	dataevent.Emit("workflow", id) // goal 0017: live-sync every open surface
	return nil
}

// insertAtLocked reinserts wf at idx (clamped to the current length) --
// caller must hold c.mu. Used to undo DeleteWorkflow's removal when the
// tombstone or persist step that must accompany it fails (docs/goals/0025
// item 2's memory-vs-store consistency rule); the exact index rarely
// matters (nothing depends on workflow order), it's just the least
// surprising place to put it back.
func (c *CompositionService) insertAtLocked(idx int, wf composition.Workflow) {
	if idx < 0 || idx > len(c.user) {
		idx = len(c.user)
	}
	c.user = append(c.user, composition.Workflow{})
	copy(c.user[idx+1:], c.user[idx:])
	c.user[idx] = wf
}
