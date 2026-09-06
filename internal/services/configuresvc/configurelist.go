package configuresvc

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

// listDescriptor is List's entitystore.Descriptor (goal 0165): the
// small per-kind shape Create/Delete/reconcile/Reset/Restorable/
// Restore all key off, replacing what used to be ~10 hand-copied
// methods. UpdateList and the row-level RPCs below keep their own
// findListLocked-based bodies -- List's field-evolution-with-rows
// check and row mutations aren't part of the shape every other entity
// kind shares.
var listDescriptor = entitystore.Descriptor[list.List]{
	Label:     "list",
	GetID:     func(l list.List) string { return l.ID },
	IsBuiltIn: func(l list.List) bool { return l.BuiltIn },
	GetSeed:   func(l list.List) seedorigin.Origin { return l.Seed },
	SetSeed:   func(l list.List, o seedorigin.Origin) list.List { l.Seed = o; return l },
	StampNew: func(l list.List, now time.Time) list.List {
		l.CreatedAt, l.UpdatedAt = now, now
		return l
	},
	Upgrade: upgradeListToGolden,
	BuiltIn: list.BuiltIn,
}

// upgradeListToGolden replaces existing's content -- including Rows --
// with golden's. golden's Row IDs are stable literals (list.BuiltIn's
// own activeRow/expiredRow helpers), so this is safe to replace
// wholesale rather than row-by-row diffing. Shared by
// reconcileBuiltInLists' upgrade branch and ResetListToSeed via
// listDescriptor.Upgrade.
func upgradeListToGolden(existing, golden list.List, now time.Time) list.List {
	golden.CreatedAt = existing.CreatedAt
	golden.UpdatedAt = now
	golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
	return golden
}

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

// CreateListWithRows creates a list and appends its first rows in one
// door -- the table noun's and the plugin content door's shared
// creation path (goal 0310): one round trip, and the rows are on the
// list before any reader sees it.
func (c *ConfigureService) CreateListWithRows(label, description string, columns []typedfield.Field, rows []map[string]string) (list.List, error) {
	l, err := c.CreateList(label, description, columns)
	if err != nil {
		return list.List{}, err
	}
	for _, values := range rows {
		if l, err = c.AddListRow(l.ID, values); err != nil {
			return list.List{}, err
		}
	}
	return l, nil
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

	if err := entitystore.Insert(&c.mu, &c.lists, c.persistLists, listDescriptor, l); err != nil {
		return list.List{}, err
	}
	dataevent.Emit("list", l.ID) // goal 0017: live-sync every open surface
	return l, nil
}

// newFieldTombstones names any Column Key+Type this call is deleting
// right now -- the explicit, UI-declared half of docs/adr/0040
// decision 3's evolution check (typedfield.ValidateFieldEvolution's
// own doc comment has the full rule).
func (c *ConfigureService) UpdateList(id, label, description string, columns []typedfield.Field, newFieldTombstones []typedfield.FieldTombstone) (list.List, error) {
	updated, err := entitystore.Update(&c.mu, &c.lists, c.persistLists, listDescriptor, id, func(previous list.List) (list.List, error) {
		l := previous
		tombstones := typedfield.MergeTombstones(previous.FieldTombstones, newFieldTombstones)
		if err := list.ValidateFieldEvolutionWithRows(previous.Columns, columns, tombstones, previous.Rows); err != nil {
			return list.List{}, err
		}
		// CreatedAt is preserved from the stored entity, never trusted
		// from the wire; UpdatedAt always advances on a real update.
		l.Label, l.Description, l.Columns, l.FieldTombstones = label, description, columns, tombstones
		l.UpdatedAt = time.Now()
		l.Seed = l.Seed.Touch() // docs/goals/0037 item 2
		if err := list.Validate(l); err != nil {
			return list.List{}, err
		}
		return l, nil
	})
	if err != nil {
		return list.List{}, err
	}
	dataevent.Emit("list", updated.ID) // goal 0017: live-sync every open surface
	return updated, nil
}

func (c *ConfigureService) DeleteList(id string) error {
	if err := c.refIntegrityError("list", "list", id); err != nil {
		return err
	}
	// A deleted built-in gets a tombstone so top-up seeding never
	// resurrects it -- same discipline DeleteHTTPRequest/DeleteDecision
	// already apply. Removal and tombstone must succeed together
	// (docs/goals/0025 item 2): an untombstoned removal would silently
	// come back on the next restart's top-up seeding.
	recordTombstone := func(id string) error { return seeding.RecordTombstone(c.store, id) }
	clearTombstone := func(id string) error { return seeding.ClearTombstone(c.store, id) }
	restore, err := entitystore.DeleteRecoverable(&c.mu, &c.lists, c.persistLists, recordTombstone, clearTombstone, listDescriptor, id)
	if err != nil {
		return err
	}
	c.undo.remember("list", id, restore)
	dataevent.Emit("list", id) // goal 0017: live-sync every open surface
	return nil
}

// --- persistence ---

func (c *ConfigureService) persistLists() error {
	return entitystore.Persist(&c.mu, &c.lists, c.store, listsKey, listDescriptor)
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
