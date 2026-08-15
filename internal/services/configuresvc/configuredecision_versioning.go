package configuresvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// Decision lifecycle & versioning (docs/adr/0040 decision 4): the
// Wails-facing layer over internal/domain/decision/versioning.go's pure
// logic, mirroring CompositionService's own workflow-versioning split
// (compositionservice_versioning.go) at the fidelity Configure's
// simpler CRUD-page idiom needs -- a Publish action and a read-only
// version history, no draft/rollback controls (Decision has no
// separate "test vs. triggered" run kind to gate a rollback against,
// unlike Workflow).

// PublishDecision snapshots id's current draft (Label/Category/
// Outputs/WebhookRequestID) as the next immutable DecisionVersion and
// advances PublishedVersion to it -- the audit-stamp reference point a
// run's "live@N" label reads (docs/adr/0040 decision 5). Unlike
// PublishWorkflow, this does NOT change what an unpinned decision-outcome
// node resolves (decision.ResolveOutcome always reads the live draft) --
// only what a NEW pin created after this call can pin to, and what an
// unpinned run's audit stamp names as "the last publish."
func (c *ConfigureService) PublishDecision(id string) (decision.Decision, error) {
	c.mu.Lock()
	idx := -1
	for i, d := range c.decisions {
		if d.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return decision.Decision{}, fmt.Errorf("no decision with id %q", id)
	}
	previous := c.decisions[idx]
	published := decision.PublishHead(previous, time.Now())
	published.UpdatedAt = time.Now()
	// Modified latch (docs/goals/0037 item 2), same reasoning as
	// UpdateDecision's own Seed.Touch() call: publishing a built-in
	// example's own draft is a real content change, so it must
	// permanently protect that instance from reconcile's upgrade path
	// exactly like any other edit does.
	published.Seed = published.Seed.Touch()
	c.decisions[idx] = published
	c.mu.Unlock()

	if err := c.persistDecisions(); err != nil {
		c.mu.Lock()
		for i, d := range c.decisions {
			if d.ID == id {
				c.decisions[i] = previous
				break
			}
		}
		c.mu.Unlock()
		return decision.Decision{}, fmt.Errorf("publish decision: %w", err)
	}
	dataevent.Emit("decision", id) // goal 0017: live-sync every open surface
	return published, nil
}
