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

// resolveList implements composition.go's lookupListFn seam.
// pinnedVersion routes through list.Resolve (docs/adr/0040 decisions
// 4-5, applied to List by goal 0070) -- the ONE seam that decides
// live-vs-pinned; this method's only job is finding the List and
// adapting its result to composition's own ResolvedList shape. Entries
// is list.DeriveEntries's own computed key/value view (goal 0011) --
// list-lookup keeps reading a flat map with zero changes to its own
// execution logic; Columns/Rows are the typed additions list-search
// reads.
func (c *ConfigureService) resolveList(id string, pinnedVersion int) (composition.ResolvedList, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, l := range c.lists {
		if l.ID == id {
			resolved, err := list.Resolve(l, pinnedVersion)
			if err != nil {
				return composition.ResolvedList{}, err
			}
			entriesView := l
			entriesView.Columns, entriesView.Rows = resolved.Columns, resolved.Rows
			return composition.ResolvedList{
				Entries:      list.DeriveEntries(entriesView),
				Columns:      resolved.Columns,
				Rows:         resolved.Rows,
				VersionStamp: resolved.VersionStamp,
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
	return c.createListWithID(seeding.NewSlugID(label, "list"), label, description, columns, nil)
}

// createListWithID is CreateList's own logic, parameterized on the new
// list's id -- the seam ImportList uses to preserve a caller-supplied
// id (ADR-0036 decision 3). fieldTombstones lets an import carry a
// portable export's own deletion history forward onto the fresh local
// entity (nil for every ordinary CreateList call, which starts with
// none).
func (c *ConfigureService) createListWithID(id, label, description string, columns []typedfield.Field, fieldTombstones []typedfield.FieldTombstone) (list.List, error) {
	now := time.Now()
	l := list.List{
		ID: id, Label: label, Description: description,
		Columns: columns, FieldTombstones: fieldTombstones, CreatedAt: now, UpdatedAt: now,
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

// newFieldTombstones names any Column Key+Type this call is deleting
// right now -- the explicit, UI-declared half of docs/adr/0040
// decision 3's evolution check (typedfield.ValidateFieldEvolution's
// own doc comment has the full rule).
func (c *ConfigureService) UpdateList(id, label, description string, columns []typedfield.Field, newFieldTombstones []typedfield.FieldTombstone) (list.List, error) {
	c.mu.Lock()
	idx := c.findListLocked(id)
	if idx == -1 {
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("no list with id %q", id)
	}
	previous := c.lists[idx]
	l := previous
	tombstones := typedfield.MergeTombstones(previous.FieldTombstones, newFieldTombstones)
	if err := list.ValidateFieldEvolutionWithRows(previous.Columns, columns, tombstones, previous.Rows); err != nil {
		c.mu.Unlock()
		return list.List{}, err
	}
	// CreatedAt is preserved from the stored entity, never trusted from
	// the wire; UpdatedAt always advances on a real update.
	l.Label, l.Description, l.Columns, l.FieldTombstones = label, description, columns, tombstones
	l.UpdatedAt = time.Now()
	l.Seed = l.Seed.Touch() // docs/goals/0037 item 2
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
	return c.AddListRowAt(listID, values, -1)
}

// AddListRowAt inserts the new row at index (goal 0105 part 2: the
// boundary-insert affordance -- a row lands exactly where the user
// pointed, not only at the end). Any out-of-range index appends,
// which is also AddListRow's own behavior.
func (c *ConfigureService) AddListRowAt(listID string, values map[string]string, index int) (list.List, error) {
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
	rows := append([]list.Row{}, l.Rows...)
	if index < 0 || index > len(rows) {
		index = len(rows)
	}
	rows = append(rows[:index], append([]list.Row{row}, rows[index:]...)...)
	l.Rows = rows
	l.UpdatedAt = now
	l.Seed = l.Seed.Touch() // docs/goals/0037 item 2
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
	l.Seed = l.Seed.Touch() // docs/goals/0037 item 2
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
	l.Seed = l.Seed.Touch() // docs/goals/0037 item 2
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
	if err := c.refIntegrityError("list", "list", id); err != nil {
		return err
	}

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

// ListProjectionData is the render-ready view Atlas's table
// projection consumes (goal 0105, atlassvc/atlasprojection.go).
// Exported for main.go wiring only, never a frontend RPC. ok is false
// when no List carries the id -- the projection's honest missing
// state, not an error.
//
//wails:ignore
func (c *ConfigureService) ListProjectionData(listID string) (label string, columns []typedfield.Field, rows []ProjectionRowData, ok bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, l := range c.lists {
		if l.ID != listID {
			continue
		}
		columns = append(columns, l.Columns...)
		for _, r := range l.Rows {
			vals := make(map[string]string, len(r.Values))
			for k, v := range r.Values {
				vals[k] = v
			}
			rows = append(rows, ProjectionRowData{ID: r.ID, Status: string(r.Status), Values: vals})
		}
		return l.Label, columns, rows, true
	}
	return "", nil, nil, false
}

// ProjectionRowData is ListProjectionData's per-row shape -- id and
// status ride along so in-place edits commit against the right row
// without flipping its lifecycle state.
type ProjectionRowData struct {
	ID     string
	Status string
	Values map[string]string
}

// GetList returns one List by id -- the grid's schema edits read the
// current record through this instead of fetching every list (goal
// 0147's O(all-lists)-per-column-edit finding).
func (c *ConfigureService) GetList(id string) (list.List, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	idx := c.findListLocked(id)
	if idx == -1 {
		return list.List{}, fmt.Errorf("no list with id %q", id)
	}
	return c.lists[idx], nil
}
