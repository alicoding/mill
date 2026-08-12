package configuresvc

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// List CRUD/persistence -- split out of configureservice.go (goal
// 0017) once adding the live-sync dataevent.Emit calls below would
// have pushed that file past CLAUDE.md's 500-line convention. Same
// per-entity-file organization configuremcpserver.go/configuredecision.go/
// configureexecenv.go's own header comments already established --
// Lists was the one entity type still living in the main file.

// resolveList implements composition.go's lookupListFn seam. Entries
// is list.DeriveEntries's own computed key/value view (goal 0011) --
// list-lookup keeps reading a flat map with zero changes to its own
// execution logic; Columns/Rows are the typed additions list-search
// reads.
func (c *ConfigureService) resolveList(id string) (composition.ResolvedList, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, l := range c.lists {
		if l.ID == id {
			return composition.ResolvedList{
				Entries: list.DeriveEntries(l),
				Columns: l.Columns,
				Rows:    l.Rows,
			}, nil
		}
	}
	return composition.ResolvedList{}, fmt.Errorf("no list with id %q", id)
}

// --- Lists ---

func (c *ConfigureService) Lists() []list.List {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]list.List, len(c.lists))
	copy(out, c.lists)
	return out
}

// findListLocked returns the index of the list with id in c.lists, or
// -1 -- caller must hold c.mu.
func (c *ConfigureService) findListLocked(id string) int {
	for i, l := range c.lists {
		if l.ID == id {
			return i
		}
	}
	return -1
}

// removeListByIDLocked removes the list with id from c.lists, if
// present -- caller must hold c.mu.
func (c *ConfigureService) removeListByIDLocked(id string) {
	if idx := c.findListLocked(id); idx != -1 {
		c.lists = append(c.lists[:idx], c.lists[idx+1:]...)
	}
}

// revertListLocked restores previous (keyed by its own ID) into
// c.lists -- caller must hold c.mu. Shared undo path for every List/
// row mutation below's persist-failure revert (docs/goals/0025 item
// 2's memory-vs-store rule, extended here from CreateList/UpdateList
// to the new row-level mutations for the same reason: a phantom
// in-memory row a restart would silently drop is exactly as wrong as
// a phantom list).
func (c *ConfigureService) revertListLocked(previous list.List) {
	if idx := c.findListLocked(previous.ID); idx != -1 {
		c.lists[idx] = previous
	}
}

func (c *ConfigureService) CreateList(label, description string, columns []typedfield.Field) (list.List, error) {
	now := time.Now()
	l := list.List{
		ID: seeding.NewSlugID(label, "list"), Label: label, Description: description,
		Columns: columns, CreatedAt: now, UpdatedAt: now,
	}
	if err := list.Validate(l); err != nil {
		return list.List{}, err
	}

	c.mu.Lock()
	c.lists = append(c.lists, l)
	c.mu.Unlock()

	if err := c.persistLists(); err != nil {
		// Don't leave a phantom-saved list in memory that a restart
		// would drop (docs/goals/0025 item 2's memory-vs-store rule).
		c.mu.Lock()
		c.removeListByIDLocked(l.ID)
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("save list: %w", err)
	}
	dataevent.Emit("list", l.ID) // goal 0017: live-sync every open surface
	return l, nil
}

func (c *ConfigureService) UpdateList(id, label, description string, columns []typedfield.Field) (list.List, error) {
	c.mu.Lock()
	idx := c.findListLocked(id)
	if idx == -1 {
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("no list with id %q", id)
	}
	previous := c.lists[idx]
	l := previous
	// CreatedAt is preserved from the stored entity, never trusted from
	// the wire; UpdatedAt always advances on a real update.
	l.Label, l.Description, l.Columns = label, description, columns
	l.UpdatedAt = time.Now()
	if err := list.Validate(l); err != nil {
		c.mu.Unlock()
		return list.List{}, err
	}
	c.lists[idx] = l
	c.mu.Unlock()

	if err := c.persistLists(); err != nil {
		c.mu.Lock()
		c.revertListLocked(previous)
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("save list: %w", err)
	}
	dataevent.Emit("list", l.ID) // goal 0017: live-sync every open surface
	return l, nil
}

// AddListRow appends a new, Active row to a List, minting its ID here
// (row-ID generation stays a service-layer concern, same as List IDs
// themselves via seeding.NewSlugID -- internal/domain/list stays pure
// per .claude/rules/backend.md).
func (c *ConfigureService) AddListRow(listID string, values map[string]string) (list.List, error) {
	c.mu.Lock()
	idx := c.findListLocked(listID)
	if idx == -1 {
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("no list with id %q", listID)
	}
	previous := c.lists[idx]
	now := time.Now()
	row := list.Row{
		ID: seeding.NewSlugID("", "row"), Values: values,
		CreatedAt: now, UpdatedAt: now, Status: list.RowActive,
	}
	l := previous
	l.Rows = append(append([]list.Row{}, l.Rows...), row)
	l.UpdatedAt = now
	if err := list.Validate(l); err != nil {
		c.mu.Unlock()
		return list.List{}, err
	}
	c.lists[idx] = l
	c.mu.Unlock()

	if err := c.persistLists(); err != nil {
		c.mu.Lock()
		c.revertListLocked(previous)
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("save list: %w", err)
	}
	dataevent.Emit("list", l.ID) // goal 0017: live-sync every open surface
	return l, nil
}

// UpdateListRow replaces one row's Values/Status (its ID/CreatedAt
// stay put; UpdatedAt is stamped here, not client-supplied).
func (c *ConfigureService) UpdateListRow(listID, rowID string, values map[string]string, status list.RowStatus) (list.List, error) {
	c.mu.Lock()
	idx := c.findListLocked(listID)
	if idx == -1 {
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("no list with id %q", listID)
	}
	previous := c.lists[idx]
	l := previous
	rowIdx := -1
	for i, r := range l.Rows {
		if r.ID == rowID {
			rowIdx = i
			break
		}
	}
	if rowIdx == -1 {
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("no row with id %q in list %q", rowID, listID)
	}
	if status == "" {
		status = list.RowActive
	}
	now := time.Now()
	rows := append([]list.Row{}, l.Rows...)
	rows[rowIdx].Values = values
	rows[rowIdx].Status = status
	rows[rowIdx].UpdatedAt = now
	l.Rows = rows
	l.UpdatedAt = now
	if err := list.Validate(l); err != nil {
		c.mu.Unlock()
		return list.List{}, err
	}
	c.lists[idx] = l
	c.mu.Unlock()

	if err := c.persistLists(); err != nil {
		c.mu.Lock()
		c.revertListLocked(previous)
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("save list: %w", err)
	}
	dataevent.Emit("list", l.ID) // goal 0017: live-sync every open surface
	return l, nil
}

func (c *ConfigureService) DeleteListRow(listID, rowID string) (list.List, error) {
	c.mu.Lock()
	idx := c.findListLocked(listID)
	if idx == -1 {
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("no list with id %q", listID)
	}
	previous := c.lists[idx]
	l := previous
	rows := make([]list.Row, 0, len(l.Rows))
	found := false
	for _, r := range l.Rows {
		if r.ID == rowID {
			found = true
			continue
		}
		rows = append(rows, r)
	}
	if !found {
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("no row with id %q in list %q", rowID, listID)
	}
	l.Rows = rows
	l.UpdatedAt = time.Now()
	c.lists[idx] = l
	c.mu.Unlock()

	if err := c.persistLists(); err != nil {
		c.mu.Lock()
		c.revertListLocked(previous)
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("save list: %w", err)
	}
	dataevent.Emit("list", l.ID) // goal 0017: live-sync every open surface
	return l, nil
}

func (c *ConfigureService) DeleteList(id string) error {
	c.mu.Lock()
	idx := -1
	for i, l := range c.lists {
		if l.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return fmt.Errorf("no list with id %q", id)
	}
	removed := c.lists[idx]
	wasBuiltIn := removed.BuiltIn
	c.lists = append(c.lists[:idx], c.lists[idx+1:]...)
	c.mu.Unlock()

	// A deleted built-in gets a tombstone so top-up seeding never
	// resurrects it (topUpBuiltInLists, configureservice_builtin.go) --
	// same discipline DeleteHTTPRequest/DeleteDecision already apply.
	// Removal and tombstone must succeed together (docs/goals/0025 item
	// 2): an untombstoned removal would silently come back on the next
	// restart's top-up seeding.
	if wasBuiltIn {
		if err := seeding.RecordTombstone(c.store, id); err != nil {
			c.mu.Lock()
			c.lists = insertListAt(c.lists, idx, removed)
			c.mu.Unlock()
			return fmt.Errorf("tombstone deleted list %q: %w", id, err)
		}
	}
	if err := c.persistLists(); err != nil {
		c.mu.Lock()
		c.lists = insertListAt(c.lists, idx, removed)
		c.mu.Unlock()
		return fmt.Errorf("save list deletion: %w", err)
	}
	dataevent.Emit("list", id) // goal 0017: live-sync every open surface
	return nil
}

// insertListAt reinserts l at idx (clamped to the current length) --
// used to undo DeleteList's removal when the tombstone or persist step
// that must accompany it fails.
func insertListAt(lists []list.List, idx int, l list.List) []list.List {
	if idx < 0 || idx > len(lists) {
		idx = len(lists)
	}
	lists = append(lists, list.List{})
	copy(lists[idx+1:], lists[idx:])
	lists[idx] = l
	return lists
}

// --- persistence ---

func (c *ConfigureService) persistLists() error {
	c.mu.Lock()
	lists := make([]list.List, len(c.lists))
	copy(lists, c.lists)
	c.mu.Unlock()

	data, err := json.Marshal(lists)
	if err != nil {
		return fmt.Errorf("marshal lists: %w", err)
	}
	if err := c.store.Set(listsKey, string(data)); err != nil {
		return fmt.Errorf("persist lists: %w", err)
	}
	return nil
}

// migrateLegacyLists converts any pre-0011 flat key/value List
// (Columns/Rows empty, Entries populated) into the typed shape once,
// in place, and re-persists -- goal 0011's decided backward-compat
// approach (list.MigrateLegacyEntries's own doc comment has the full
// reasoning). A list that's already typed, or one that's genuinely
// empty, is left untouched. Runs on every restore() call, but the
// migration is idempotent (a list only ever qualifies once -- after
// migrating, it carries Columns, so the condition never fires again),
// so persisting again on a later restart is a cheap no-op.
func (c *ConfigureService) migrateLegacyLists() {
	changed := false
	for i, l := range c.lists {
		if len(l.Columns) > 0 || len(l.Entries) == 0 {
			continue
		}
		columns, rows := list.MigrateLegacyEntries(l.Entries, func() string { return seeding.NewSlugID("", "row") })
		c.lists[i].Columns = columns
		c.lists[i].Rows = rows
		changed = true
	}
	if changed {
		// Startup migration, not a user-initiated RPC -- nothing to
		// return the error to (this runs from restore()). Logged so a
		// failure is diagnosable rather than silently dropped
		// (docs/goals/0025 item 1's fire-and-forget bucket); worst
		// case the migration simply re-runs identically on the next
		// launch, since Entries itself is untouched by this function.
		if err := c.persistLists(); err != nil {
			slog.Error("failed to persist migrated legacy lists", "error", err)
		}
	}
}
