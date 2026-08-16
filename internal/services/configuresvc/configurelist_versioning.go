package configuresvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// List lifecycle & versioning (docs/adr/0040 decision 4, goal 0070):
// the Wails-facing layer over internal/domain/list/versioning.go's pure
// logic, mirroring ConfigureService's own PublishDecision split
// (configuredecision_versioning.go) at the identical fidelity -- a
// Publish action and a read-only version history, no draft/rollback
// controls (a List has no separate "test vs. triggered" run kind to
// gate a rollback against, same reasoning Decision's own split
// documents).

// PublishList snapshots id's current draft (Columns+Rows) as the next
// immutable ListVersion and advances PublishedVersion to it -- the
// audit-stamp reference point a pinned/unpinned list-lookup/list-search
// run's "v<N>"/"live@<N>" label reads (docs/adr/0040 decision 5).
func (c *ConfigureService) PublishList(id string) (list.List, error) {
	c.mu.Lock()
	idx := c.findListLocked(id)
	if idx == -1 {
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("no list with id %q", id)
	}
	previous := c.lists[idx]
	published := list.PublishHead(previous, time.Now())
	published.UpdatedAt = time.Now()
	// Modified latch (docs/goals/0037 item 2), same reasoning
	// PublishDecision's own identical call documents: publishing a
	// built-in example's own draft is a real content change, so it must
	// permanently protect that instance from reconcile's upgrade path
	// exactly like any other edit does.
	published.Seed = published.Seed.Touch()
	c.lists[idx] = published
	c.mu.Unlock()

	if err := c.persistLists(); err != nil {
		c.mu.Lock()
		c.revertListLocked(previous)
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("publish list: %w", err)
	}
	dataevent.Emit("list", id) // goal 0017: live-sync every open surface
	return published, nil
}
