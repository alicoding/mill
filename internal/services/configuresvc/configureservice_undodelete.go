package configuresvc

import (
	"fmt"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// Configure's delete undo (goal 0270): a delete removes the entity at
// once and keeps its way back here; UndoDelete puts it back. The buffer
// is in-memory -- a restart forgets it, like the toast that offers it --
// and bounded in both age and size.
const (
	undoWindow  = 10 * time.Minute
	undoEntries = 50
)

type deleteUndo struct {
	mu      sync.Mutex
	entries []undoEntry
}

type undoEntry struct {
	entity, id string
	restore    func() error
	expires    time.Time
}

// remember keeps one way back per entity id, dropping expired entries
// and the oldest beyond the cap.
func (u *deleteUndo) remember(entity, id string, restore func() error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	now := time.Now()
	kept := u.entries[:0]
	for _, e := range u.entries {
		if e.expires.After(now) && (e.entity != entity || e.id != id) {
			kept = append(kept, e)
		}
	}
	kept = append(kept, undoEntry{entity: entity, id: id, restore: restore, expires: now.Add(undoWindow)})
	u.entries = kept
	if len(u.entries) > undoEntries {
		u.entries = u.entries[len(u.entries)-undoEntries:]
	}
}

func (u *deleteUndo) take(entity, id string) (func() error, bool) {
	u.mu.Lock()
	defer u.mu.Unlock()
	for i, e := range u.entries {
		if e.entity != entity || e.id != id {
			continue
		}
		u.entries = append(u.entries[:i], u.entries[i+1:]...)
		if !e.expires.After(time.Now()) {
			return nil, false
		}
		return e.restore, true
	}
	return nil, false
}

// UndoDelete restores an entity deleted while the app has been running. entity
// is the family's data-event name ("list", "request", "decision", ...),
// id the deleted entity's id. Credential material purged by the delete
// is not restored: the entity comes back with its secret unset, which
// its own status reads report honestly.
func (c *ConfigureService) UndoDelete(entity, id string) error {
	restore, ok := c.undo.take(entity, id)
	if !ok {
		return fmt.Errorf("nothing to undo for %s %q", entity, id)
	}
	if err := restore(); err != nil {
		return err
	}
	dataevent.Emit(entity, id)
	return nil
}

// httpRequestRestorer is DeleteHTTPRequest's way back: the hand-written
// family reinserts at the original index, clears a built-in's
// tombstone, and persists, mirroring entitystore.DeleteRecoverable.
func (c *ConfigureService) httpRequestRestorer(id string, idx int, removed httprequest.HTTPRequest, wasBuiltIn bool) func() error {
	return func() error {
		c.mu.Lock()
		for _, r := range c.requests {
			if r.ID == id {
				c.mu.Unlock()
				return fmt.Errorf("a request with id %q already exists", id)
			}
		}
		c.requests = insertHTTPRequestAt(c.requests, idx, removed)
		c.mu.Unlock()
		if wasBuiltIn {
			if err := seeding.ClearTombstone(c.store, id); err != nil {
				return fmt.Errorf("clear tombstone of restored request %q: %w", id, err)
			}
		}
		if err := c.persistHTTPRequests(); err != nil {
			return fmt.Errorf("save restored request: %w", err)
		}
		return nil
	}
}
