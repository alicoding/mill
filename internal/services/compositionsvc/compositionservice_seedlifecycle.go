package compositionsvc

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// Seed lifecycle (docs/goals/0037): reconcile (the insert/upgrade/
// leave-alone/skip successor to the old insert-only topUpBuiltIns),
// reset-to-shipped-example, and restore-deleted-example. Split into its
// own file per the 500-line convention, same per-concern organization
// compositionservice_versioning.go/compositionservice_export.go
// already follow.

// reconcileBuiltIns replaces the old topUpBuiltIns: for every golden
// workflow, absent+untombstoned inserts it (stamped at the golden's
// SeedRevision); present+unmodified+stale upgrades it in place (a new
// published version carrying the golden's content -- history
// preserved, rollback free via the existing Versions UI, ADR-0021);
// present+Modified is left entirely alone regardless of revision
// drift (the write-time latch is the authority, never a content diff
// -- docs/goals/0037's research: this is deliberately the Kubernetes
// Server-Side-Apply move away from client-side hash/diff detection);
// tombstoned is skipped. An existing entry whose ID matches a golden
// but carries no SeedOrigin at all (SeedRevision == 0 -- a pre-goal-
// 0037 install) is migration-stamped Modified: true in the same pass:
// conservative, since silently upgrading data that predates this
// entire feature would be exactly the silent-clobber failure mode the
// design exists to avoid -- the reset affordance is that install's own
// explicit path back to golden, if wanted.
func (c *CompositionService) reconcileBuiltIns() {
	tombstones := seeding.LoadTombstones(c.store)
	now := time.Now()

	c.mu.Lock()
	byID := make(map[string]int, len(c.user))
	for i, wf := range c.user {
		byID[wf.ID] = i
	}
	changed := false
	for _, golden := range composition.BuiltInWorkflows() {
		idx, present := byID[golden.ID]
		if !present {
			if tombstones[golden.ID] {
				continue
			}
			golden.CreatedAt = now
			golden.UpdatedAt = now
			c.user = append(c.user, golden)
			changed = true
			continue
		}
		existing := c.user[idx]
		if existing.Seed.SeedRevision == 0 {
			existing.Seed = seedorigin.Origin{SeedRevision: golden.Seed.SeedRevision, Modified: true}
			c.user[idx] = existing
			changed = true
			continue
		}
		if existing.Seed.Modified {
			continue
		}
		if existing.Seed.SeedRevision < golden.Seed.SeedRevision {
			c.user[idx] = upgradeWorkflowToGolden(existing, golden, now)
			changed = true
		}
	}
	c.mu.Unlock()

	if changed {
		// Startup reconciliation, same fire-and-forget/log-only
		// treatment the old topUpBuiltIns already used (nothing to
		// return the error to -- this runs from the constructor).
		if err := c.persist(); err != nil {
			slog.Error("failed to reconcile built-in workflows", "error", err)
		}
	}
}

// upgradeWorkflowToGolden replaces existing's head content with
// golden's and publishes it as a new version -- shared by
// reconcileBuiltIns' upgrade branch and ResetWorkflowToSeed (the
// explicit, on-demand version of the same operation). Preserves
// existing's identity/lifecycle metadata (ID, CreatedAt, Disabled,
// prior Versions) -- only the draft head and the published pointer
// move.
func upgradeWorkflowToGolden(existing, golden composition.Workflow, now time.Time) composition.Workflow {
	existing.Label = golden.Label
	existing.Description = golden.Description
	existing.Nodes = golden.Nodes
	existing.Edges = golden.Edges
	existing.Attributes = golden.Attributes
	existing = composition.PublishHead(existing, now)
	existing.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
	existing.UpdatedAt = now
	return existing
}

// findGoldenWorkflow returns a copy of the golden workflow with id, if
// one exists among composition.BuiltInWorkflows() -- shared lookup for
// ResetWorkflowToSeed/RestoreWorkflow.
func findGoldenWorkflow(id string) (composition.Workflow, bool) {
	for _, g := range composition.BuiltInWorkflows() {
		if g.ID == id {
			return g, true
		}
	}
	return composition.Workflow{}, false
}

// ResetWorkflowToSeed replaces id's content with the current golden's
// (docs/goals/0037 item 4) -- a new published version, non-destructive
// (the prior history stays in Versions, reachable via the existing
// rollback UI), and clears the Modified latch. Deliberately its own
// method, not routed through mutateWorkflow: mutateWorkflow's own
// choke point (below) unconditionally re-latches Modified on every
// call, which would immediately undo the very reset this performs.
func (c *CompositionService) ResetWorkflowToSeed(id string) (composition.Workflow, error) {
	golden, ok := findGoldenWorkflow(id)
	if !ok {
		return composition.Workflow{}, fmt.Errorf("no built-in workflow with id %q", id)
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
		return composition.Workflow{}, fmt.Errorf("no workflow with id %q", id)
	}
	previous := c.user[idx]
	updated := upgradeWorkflowToGolden(previous, golden, time.Now())
	c.user[idx] = updated
	c.mu.Unlock()

	if err := c.persist(); err != nil {
		c.mu.Lock()
		c.restoreByIDLocked(id, previous)
		c.mu.Unlock()
		return composition.Workflow{}, fmt.Errorf("save reset workflow: %w", err)
	}
	c.notifySyncer()
	dataevent.Emit("workflow", id) // goal 0017: live-sync every open surface
	return updated, nil
}

// RestorableWorkflows returns every built-in workflow the user
// deliberately deleted (tombstoned) and not since restored -- the read
// model for a "Restore example…" affordance (docs/goals/0037 item 5),
// shown only when non-empty.
func (c *CompositionService) RestorableWorkflows() []composition.Workflow {
	tombstones := seeding.LoadTombstones(c.store)
	if len(tombstones) == 0 {
		return nil
	}
	c.mu.Lock()
	have := make(map[string]bool, len(c.user))
	for _, wf := range c.user {
		have[wf.ID] = true
	}
	c.mu.Unlock()

	var out []composition.Workflow
	for _, golden := range composition.BuiltInWorkflows() {
		if tombstones[golden.ID] && !have[golden.ID] {
			out = append(out, golden)
		}
	}
	return out
}

// RestoreWorkflow un-tombstones id and re-seeds it at the current
// golden's content -- the reverse of DeleteWorkflow for a built-in
// (docs/goals/0037 item 5).
func (c *CompositionService) RestoreWorkflow(id string) (composition.Workflow, error) {
	golden, ok := findGoldenWorkflow(id)
	if !ok {
		return composition.Workflow{}, fmt.Errorf("no built-in workflow with id %q", id)
	}

	c.mu.Lock()
	for _, existing := range c.user {
		if existing.ID == id {
			c.mu.Unlock()
			return composition.Workflow{}, fmt.Errorf("workflow %q is already present, nothing to restore", id)
		}
	}
	c.mu.Unlock()

	if err := seeding.ClearTombstone(c.store, id); err != nil {
		return composition.Workflow{}, fmt.Errorf("clear tombstone for %q: %w", id, err)
	}

	now := time.Now()
	golden.CreatedAt = now
	golden.UpdatedAt = now

	c.mu.Lock()
	c.user = append(c.user, golden)
	c.mu.Unlock()

	if err := c.persist(); err != nil {
		c.mu.Lock()
		c.removeByIDLocked(id)
		c.mu.Unlock()
		return composition.Workflow{}, fmt.Errorf("save restored workflow: %w", err)
	}
	c.notifySyncer()
	dataevent.Emit("workflow", id) // goal 0017: live-sync every open surface
	return golden, nil
}
