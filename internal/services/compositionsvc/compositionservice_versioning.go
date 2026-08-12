package compositionsvc

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
)

// Workflow lifecycle & versioning RPCs (docs/adr/0021) -- the
// Wails-facing layer over internal/domain/composition/versioning.go's
// pure logic, split into its own file per the 500-line limit and the
// same by-concern organization the other compositionservice_* files
// already follow.

// mutateWorkflow applies fn to the workflow with id under the lock,
// persists, and re-syncs triggers (a lifecycle change can arm or
// disarm listeners -- Sync re-derives everything from scratch, which
// is exactly what ADR-0021's disable/publish gating needs).
func (c *CompositionService) mutateWorkflow(id string, fn func(composition.Workflow) (composition.Workflow, error)) (composition.Workflow, error) {
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
		return composition.Workflow{}, fmt.Errorf("no workflow with id %q", id)
	}
	updated, err := fn(c.user[idx])
	if err != nil {
		c.mu.Unlock()
		return composition.Workflow{}, err
	}
	// CreatedAt is preserved for free -- fn mutates a copy of the
	// already-stored workflow, never constructs a fresh struct literal,
	// so its CreatedAt survives untouched. UpdatedAt always advances:
	// every mutateWorkflow caller (PublishWorkflow,
	// PublishExistingVersion, RestoreVersionToDraft,
	// SetWorkflowDisabled) is a real persisted mutation.
	previous := c.user[idx]
	updated.UpdatedAt = time.Now()
	c.user[idx] = updated
	c.mu.Unlock()

	if err := c.persist(); err != nil {
		// Roll back -- same docs/goals/0025 item 2 rule as Create/
		// UpdateWorkflow: a lifecycle change (publish/disable/rollback)
		// that failed to persist must not appear to have taken effect.
		c.mu.Lock()
		c.restoreByIDLocked(id, previous)
		c.mu.Unlock()
		return composition.Workflow{}, fmt.Errorf("save workflow: %w", err)
	}
	c.notifySyncer()
	return updated, nil
}

// PublishWorkflow snapshots the draft head as the next version and
// makes it live (publish == live, one concept -- ADR-0021).
func (c *CompositionService) PublishWorkflow(id string) (composition.Workflow, error) {
	return c.mutateWorkflow(id, func(wf composition.Workflow) (composition.Workflow, error) {
		return composition.PublishHead(wf, time.Now()), nil
	})
}

// PublishExistingVersion moves the live pointer to an already-captured
// snapshot -- rollback (or roll-forward) without mutating anything.
func (c *CompositionService) PublishExistingVersion(id string, version int) (composition.Workflow, error) {
	return c.mutateWorkflow(id, func(wf composition.Workflow) (composition.Workflow, error) {
		if _, ok := composition.VersionByNumber(wf, version); !ok {
			return composition.Workflow{}, fmt.Errorf("workflow %q has no version %d", wf.Label, version)
		}
		wf.PublishedVersion = version
		return wf, nil
	})
}

// RestoreVersionToDraft copies a snapshot's definition back into the
// editable head -- the "load an old version into the editor" half of
// rollback; publishing it afterward is a separate, explicit act.
func (c *CompositionService) RestoreVersionToDraft(id string, version int) (composition.Workflow, error) {
	return c.mutateWorkflow(id, func(wf composition.Workflow) (composition.Workflow, error) {
		v, ok := composition.VersionByNumber(wf, version)
		if !ok {
			return composition.Workflow{}, fmt.Errorf("workflow %q has no version %d", wf.Label, version)
		}
		wf.Label, wf.Description = v.Label, v.Description
		wf.Nodes, wf.Edges, wf.Attributes = v.Nodes, v.Edges, v.Attributes
		return wf, nil
	})
}

// SetWorkflowDisabled flips the inactive state (ADR-0021: disabling
// pauses production -- triggers and child calls -- while test runs
// stay allowed, n8n's own semantics).
func (c *CompositionService) SetWorkflowDisabled(id string, disabled bool) (composition.Workflow, error) {
	return c.mutateWorkflow(id, func(wf composition.Workflow) (composition.Workflow, error) {
		wf.Disabled = disabled
		return wf, nil
	})
}

// migratePublish auto-publishes any workflow that predates ADR-0021
// (no versions, no published pointer) as v1 -- existing workflows'
// triggers keep firing across the upgrade with zero behavior change;
// only genuinely new workflows experience "publish is an explicit
// act." Runs after restore()+topUpBuiltIns() so seeded built-ins ship
// published too.
func (c *CompositionService) migratePublish() {
	c.mu.Lock()
	changed := false
	for i, wf := range c.user {
		if wf.PublishedVersion == 0 && len(wf.Versions) == 0 {
			c.user[i] = composition.PublishHead(wf, time.Now())
			changed = true
		}
	}
	c.mu.Unlock()
	if changed {
		// Startup migration, same fire-and-forget/log-only treatment as
		// topUpBuiltIns (compositionservice.go) -- runs from the
		// constructor, nothing to return the error to.
		if err := c.persist(); err != nil {
			slog.Error("failed to persist auto-published workflows", "error", err)
		}
	}
}
