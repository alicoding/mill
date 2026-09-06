package configuresvc

import (
	"fmt"
	"sort"

	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// A List row edit is undoable in the app's ONE actor-scoped journal
// (ADR-0044, goal 0352). A board table's cells ARE a List's rows, so
// without this the ⌘Z right after typing in a cell reached past the
// edit and deleted the table. The journal itself lives with the board
// (atlassvc), and this file is only the recording half: the row doors
// hand it a before/after pair and their own inverse, so the board's
// entries and the List page's entries sit on one history in the order
// the user made them. The origin -- board table or Configure's List
// page -- is not a separate stack; it is the same actor.
//
// Two entry families:
//   - list-cell {listID, rowID, column, previous, next} -- one cell's
//     content write. Consecutive writes to the SAME cell coalesce
//     (the journal's own 2-second fold window), so retyping a cell is
//     one ⌘Z step rather than one per commit.
//   - list-row {listID, rowID, index, row} -- a row inserted, deleted,
//     or rewritten in more than one column at once (a paste across a
//     row, a status change). Never coalesced: each is its own step.
//
// A schema edit (rename/insert/remove a column) is NOT journaled --
// UpdateList is a whole-record write, not a row door.
//
// Replay writes through the unrecorded cores in configurelistrow.go
// while the journal holds its own recording suppressed, so an undo
// persists and emits exactly like a direct edit without minting a
// second entry. An inverse whose target changed since -- the row
// deleted, the column removed -- returns an error, which the journal
// reports as its skip notice rather than applying half a step.

// listUndoRecorder is the journal's record call, injected once at the
// composition root (WireUndoJournal) -- nil, and every door below is
// inert, which is what a test or a headless build that never wires a
// board gets. Same nil-means-off seam discipline as the List
// projection reader on the other side.
type listUndoRecorder func(kind, id, label, coalesceKey string, undo, redo func() error)

// WireUndoJournal connects the List row doors to the app's actor-scoped
// undo journal. Exported for wiring only, never a frontend RPC.
//
//wails:ignore
func (c *ConfigureService) WireUndoJournal(record listUndoRecorder) {
	c.recordListUndo = record
}

// listRowSnapshot is a row exactly as it stood before a door touched
// it, plus the index it sat at -- what an inverse needs to put it back
// the way it was.
type listRowSnapshot struct {
	row   list.Row
	index int
}

// rowSnapshot reads one row before a door changes it. ok is false when
// the list or the row isn't there, in which case the door is about to
// fail anyway and nothing is recorded.
func (c *ConfigureService) rowSnapshot(listID, rowID string) (listRowSnapshot, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	idx := c.findListLocked(listID)
	if idx == -1 {
		return listRowSnapshot{}, false
	}
	l := c.lists[idx]
	i := indexOfRow(l.Rows, rowID)
	if i == -1 {
		return listRowSnapshot{}, false
	}
	row := l.Rows[i]
	row.Values = copyRowValues(row.Values)
	return listRowSnapshot{row: row, index: i}, true
}

// recordRowWrite journals what an UpdateListRow actually changed: one
// column changed on its own is a coalescing list-cell entry, anything
// wider (a pasted row, a status change) is one list-row entry that
// restores the row's whole previous values and status. A write that
// changed nothing records nothing.
func (c *ConfigureService) recordRowWrite(l list.List, before listRowSnapshot, rowID string) {
	if c.recordListUndo == nil {
		return
	}
	i := indexOfRow(l.Rows, rowID)
	if i == -1 {
		return
	}
	after := l.Rows[i]
	changed := changedColumns(before.row.Values, after.Values)
	if len(changed) == 0 && before.row.Status == after.Status {
		return
	}
	if len(changed) == 1 && before.row.Status == after.Status {
		c.recordCellWrite(l, before, rowID, changed[0], after.Values[changed[0]])
		return
	}
	previousValues, previousStatus := copyRowValues(before.row.Values), before.row.Status
	nextValues, nextStatus := copyRowValues(after.Values), after.Status
	c.recordListUndo("list-row", l.ID+"/"+rowID, l.Label, "",
		func() error { return c.restoreRowValues(l.ID, rowID, previousValues, previousStatus) },
		func() error { return c.restoreRowValues(l.ID, rowID, nextValues, nextStatus) },
	)
}

// recordCellWrite journals one cell's previous/next pair under the
// coalescing key that folds a re-typed cell into a single step.
func (c *ConfigureService) recordCellWrite(l list.List, before listRowSnapshot, rowID, column, next string) {
	previous := before.row.Values[column]
	cellID := fmt.Sprintf("%s/%s/%s", l.ID, rowID, column)
	c.recordListUndo("list-cell", cellID, l.Label, cellID,
		func() error { return c.setListCell(l.ID, rowID, column, previous) },
		func() error { return c.setListCell(l.ID, rowID, column, next) },
	)
}

// recordRowInsert journals a row the grid added: undo removes it, redo
// puts the same row back at the same index.
func (c *ConfigureService) recordRowInsert(l list.List, row list.Row, index int) {
	if c.recordListUndo == nil {
		return
	}
	row.Values = copyRowValues(row.Values)
	c.recordListUndo("list-row", l.ID+"/"+row.ID, l.Label, "",
		func() error { return c.deleteRowForUndo(l.ID, row.ID) },
		func() error { return c.restoreListRow(l.ID, row, index) },
	)
}

// recordRowDelete journals a row the grid removed: undo puts the whole
// row back where it sat, redo removes it again.
func (c *ConfigureService) recordRowDelete(l list.List, before listRowSnapshot) {
	if c.recordListUndo == nil {
		return
	}
	row, index := before.row, before.index
	c.recordListUndo("list-row", l.ID+"/"+row.ID, l.Label, "",
		func() error { return c.restoreListRow(l.ID, row, index) },
		func() error { return c.deleteRowForUndo(l.ID, row.ID) },
	)
}

// setListCell writes ONE column of one row, leaving every other column
// and the row's status as they stand right now -- an undo restores the
// cell it recorded, never a stale copy of its neighbours. Refuses when
// the row is gone or the column has since been removed from the
// schema, which is what the journal turns into its skip notice.
func (c *ConfigureService) setListCell(listID, rowID, column, value string) error {
	c.mu.Lock()
	idx := c.findListLocked(listID)
	if idx == -1 {
		c.mu.Unlock()
		return fmt.Errorf("no list with id %q", listID)
	}
	l := c.lists[idx]
	c.mu.Unlock()

	if !hasColumn(l.Columns, column) {
		return fmt.Errorf("no column %q in list %q", column, listID)
	}
	i := indexOfRow(l.Rows, rowID)
	if i == -1 {
		return fmt.Errorf("no row with id %q in list %q", rowID, listID)
	}
	values := copyRowValues(l.Rows[i].Values)
	values[column] = value
	_, err := c.updateListRow(listID, rowID, values, l.Rows[i].Status)
	return err
}

// restoreRowValues rewrites a row's whole values map and status -- the
// wide write's inverse.
func (c *ConfigureService) restoreRowValues(listID, rowID string, values map[string]string, status list.RowStatus) error {
	_, err := c.updateListRow(listID, rowID, copyRowValues(values), status)
	return err
}

func (c *ConfigureService) deleteRowForUndo(listID, rowID string) error {
	_, err := c.deleteListRow(listID, rowID)
	return err
}

// changedColumns names every column whose value differs, in a stable
// order. A key present on one side only counts as changed unless its
// value is empty -- a row that never carried a column reads the same
// as one carrying "" (list.Validate holds no per-key requirement).
func changedColumns(previous, next map[string]string) []string {
	keys := map[string]bool{}
	for k := range previous {
		keys[k] = true
	}
	for k := range next {
		keys[k] = true
	}
	var changed []string
	for k := range keys {
		if previous[k] != next[k] {
			changed = append(changed, k)
		}
	}
	sort.Strings(changed)
	return changed
}

func copyRowValues(values map[string]string) map[string]string {
	out := make(map[string]string, len(values))
	for k, v := range values {
		out[k] = v
	}
	return out
}

func hasColumn(columns []typedfield.Field, key string) bool {
	for _, c := range columns {
		if c.Key == key {
			return true
		}
	}
	return false
}
