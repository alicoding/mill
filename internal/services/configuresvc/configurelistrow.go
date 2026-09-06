package configuresvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// The List's row doors, split out of configurelist.go at the 500-line
// limit. Each door is a thin pair: an unrecorded core that does the
// write, and the exported door that runs the core and then journals it
// into the app's ONE actor-scoped undo journal (ADR-0044, goal 0352 --
// configurelistundo.go holds the recording and the replay).
//
// Which half a caller takes IS the actor distinction, the same static,
// call-site split ADR-0044 already draws with CreateCardForMCP /
// CreateCardForWorkflow: the exported doors are what the grid calls,
// so a user's own cell and row edits land on the ⌘Z history; the
// unrecorded cores are what non-gesture callers take -- built-in
// seeding, a workflow's apply-list-row/list-sync, a plugin's content
// write, the board's paste-to-table conversion -- so none of them ever
// leaves a step the user must press ⌘Z past.

// AddListRow appends a new, Active row to a List, minting its ID here
// (row-ID generation stays a service-layer concern, same as List IDs
// themselves via seeding.NewSlugID -- internal/domain/list stays pure
// per .claude/rules/backend.md). This is the in-process composition
// door -- an append made BY something else on the user's behalf -- and
// records no undo step; AddListRowAt below is the grid's own insert.
func (c *ConfigureService) AddListRow(listID string, values map[string]string) (list.List, error) {
	l, _, _, err := c.addListRowAt(listID, values, -1)
	return l, err
}

// AddListRowAt inserts the new row at index (goal 0105 part 2: the
// boundary-insert affordance -- a row lands exactly where the user
// pointed, not only at the end). Any out-of-range index appends,
// which is also AddListRow's own behavior.
func (c *ConfigureService) AddListRowAt(listID string, values map[string]string, index int) (list.List, error) {
	l, row, at, err := c.addListRowAt(listID, values, index)
	if err != nil {
		return list.List{}, err
	}
	c.recordRowInsert(l, row, at)
	return l, nil
}

// addListRowAt is AddListRowAt's own body, also reporting the row it
// minted and the index it landed at -- the journal's redo needs both
// to put the same row back in the same place.
func (c *ConfigureService) addListRowAt(listID string, values map[string]string, index int) (list.List, list.Row, int, error) {
	c.mu.Lock()
	idx := c.findListLocked(listID)
	if idx == -1 {
		c.mu.Unlock()
		return list.List{}, list.Row{}, 0, fmt.Errorf("no list with id %q", listID)
	}
	now := time.Now()
	row := list.Row{
		ID: seeding.NewSlugID("", "row"), Values: values,
		CreatedAt: now, UpdatedAt: now, Status: list.RowActive,
	}
	l, at, err := c.commitRowsLocked(idx, func(rows []list.Row) ([]list.Row, int, error) {
		if index < 0 || index > len(rows) {
			index = len(rows)
		}
		return append(rows[:index], append([]list.Row{row}, rows[index:]...)...), index, nil
	})
	if err != nil {
		return list.List{}, list.Row{}, 0, err
	}
	return l, row, at, nil
}

// UpdateListRow replaces one row's Values/Status (its ID/CreatedAt
// stay put; UpdatedAt is stamped here, not client-supplied).
func (c *ConfigureService) UpdateListRow(listID, rowID string, values map[string]string, status list.RowStatus) (list.List, error) {
	before, ok := c.rowSnapshot(listID, rowID)
	l, err := c.updateListRow(listID, rowID, values, status)
	if err != nil {
		return list.List{}, err
	}
	if ok {
		c.recordRowWrite(l, before, rowID)
	}
	return l, nil
}

// updateListRow is UpdateListRow's own body, unrecorded -- the door a
// list-sync's expiry pass and the journal's own replay take.
func (c *ConfigureService) updateListRow(listID, rowID string, values map[string]string, status list.RowStatus) (list.List, error) {
	c.mu.Lock()
	idx := c.findListLocked(listID)
	if idx == -1 {
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("no list with id %q", listID)
	}
	if status == "" {
		status = list.RowActive
	}
	now := time.Now()
	l, _, err := c.commitRowsLocked(idx, func(rows []list.Row) ([]list.Row, int, error) {
		rowIdx := indexOfRow(rows, rowID)
		if rowIdx == -1 {
			return nil, 0, fmt.Errorf("no row with id %q in list %q", rowID, listID)
		}
		rows[rowIdx].Values = values
		rows[rowIdx].Status = status
		rows[rowIdx].UpdatedAt = now
		return rows, rowIdx, nil
	})
	return l, err
}

// DeleteListRow removes one row. Its journal entry carries the whole
// row and the index it sat at, so undo puts back what was there rather
// than a fresh, empty row.
func (c *ConfigureService) DeleteListRow(listID, rowID string) (list.List, error) {
	before, ok := c.rowSnapshot(listID, rowID)
	l, err := c.deleteListRow(listID, rowID)
	if err != nil {
		return list.List{}, err
	}
	if ok {
		c.recordRowDelete(l, before)
	}
	return l, nil
}

// deleteListRow is DeleteListRow's own body, unrecorded -- the door the
// journal's own replay takes.
func (c *ConfigureService) deleteListRow(listID, rowID string) (list.List, error) {
	c.mu.Lock()
	idx := c.findListLocked(listID)
	if idx == -1 {
		c.mu.Unlock()
		return list.List{}, fmt.Errorf("no list with id %q", listID)
	}
	l, _, err := c.commitRowsLocked(idx, func(rows []list.Row) ([]list.Row, int, error) {
		rowIdx := indexOfRow(rows, rowID)
		if rowIdx == -1 {
			return nil, 0, fmt.Errorf("no row with id %q in list %q", rowID, listID)
		}
		return append(rows[:rowIdx], rows[rowIdx+1:]...), rowIdx, nil
	})
	return l, err
}

// restoreListRow puts a whole row back at index, ID/CreatedAt/Status
// intact -- the inverse a delete's undo and an insert's redo both
// apply. Unrecorded: it only ever runs from the journal.
func (c *ConfigureService) restoreListRow(listID string, row list.Row, index int) error {
	c.mu.Lock()
	idx := c.findListLocked(listID)
	if idx == -1 {
		c.mu.Unlock()
		return fmt.Errorf("no list with id %q", listID)
	}
	_, _, err := c.commitRowsLocked(idx, func(rows []list.Row) ([]list.Row, int, error) {
		if indexOfRow(rows, row.ID) != -1 {
			return nil, 0, fmt.Errorf("a row with id %q already exists in list %q", row.ID, listID)
		}
		at := index
		if at < 0 || at > len(rows) {
			at = len(rows)
		}
		return append(rows[:at], append([]list.Row{row}, rows[at:]...)...), at, nil
	})
	return err
}

// commitRowsLocked is the body every row door above shares: mutate a
// COPY of the list's rows, validate, swap in, persist, emit -- and put
// the previous list back in memory when the store write fails, so a
// phantom row a restart would silently drop can never linger
// (docs/goals/0025 item 2's memory-vs-store rule). Caller holds c.mu
// and passes the list's index; this releases the lock before
// persisting. mutate returns the new rows and the index it acted at.
func (c *ConfigureService) commitRowsLocked(idx int, mutate func(rows []list.Row) ([]list.Row, int, error)) (list.List, int, error) {
	previous := c.lists[idx]
	l := previous
	next, at, err := mutate(append([]list.Row{}, l.Rows...))
	if err != nil {
		c.mu.Unlock()
		return list.List{}, 0, err
	}
	l.Rows = next
	l.UpdatedAt = time.Now()
	l.Seed = l.Seed.Touch() // docs/goals/0037 item 2
	if err := list.Validate(l); err != nil {
		c.mu.Unlock()
		return list.List{}, 0, err
	}
	c.lists[idx] = l
	c.mu.Unlock()

	if err := c.persistLists(); err != nil {
		c.mu.Lock()
		c.revertListLocked(previous)
		c.mu.Unlock()
		return list.List{}, 0, fmt.Errorf("save list: %w", err)
	}
	dataevent.Emit("list", l.ID) // goal 0017: live-sync every open surface
	return l, at, nil
}

func indexOfRow(rows []list.Row, rowID string) int {
	for i, r := range rows {
		if r.ID == rowID {
			return i
		}
	}
	return -1
}
