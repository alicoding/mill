package configuresvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// A List row edit walks the SAME actor-scoped journal the board does
// (ADR-0044, goal 0352) -- these pin the properties the surface
// depends on: a cell edit undoes to its previous value, consecutive
// edits to one cell are ONE step, a row insert/delete round trips, a
// vanished target skips with a notice, and a board entry recorded
// before a cell edit undoes second, never first.

type undoHarness struct {
	cfg   *ConfigureService
	atlas *atlassvc.AtlasService
	list  list.List
}

func newUndoHarness(t *testing.T, rows ...map[string]string) undoHarness {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	atlas := atlassvc.NewAtlasService(store)
	cfg.WireUndoJournal(atlas.RecordExternalUndo)

	l, err := cfg.CreateListWithRows("Undo test", "", []typedfield.Field{
		{Key: "name", Label: "Name", Type: typedfield.TypeText},
		{Key: "qty", Label: "Qty", Type: typedfield.TypeText},
	}, rows)
	if err != nil {
		t.Fatalf("CreateListWithRows: %v", err)
	}
	return undoHarness{cfg: cfg, atlas: atlas, list: l}
}

// cell reads the first row's value for key -- every case below edits
// the row it seeded first.
func (h undoHarness) cell(t *testing.T, key string) string {
	t.Helper()
	rows := h.rows(t)
	if len(rows) == 0 {
		t.Fatal("the list holds no rows")
	}
	return rows[0].Values[key]
}

func (h undoHarness) rows(t *testing.T) []list.Row {
	t.Helper()
	l, err := h.cfg.GetList(h.list.ID)
	if err != nil {
		t.Fatalf("GetList: %v", err)
	}
	return l.Rows
}

// writeCell is the grid's own commit shape: the whole row's values
// with one key changed.
func (h undoHarness) writeCell(t *testing.T, rowID, key, value string) {
	t.Helper()
	l, err := h.cfg.GetList(h.list.ID)
	if err != nil {
		t.Fatalf("GetList: %v", err)
	}
	i := indexOfRow(l.Rows, rowID)
	if i == -1 {
		t.Fatalf("no row %q", rowID)
	}
	values := copyRowValues(l.Rows[i].Values)
	values[key] = value
	if _, err := h.cfg.UpdateListRow(h.list.ID, rowID, values, l.Rows[i].Status); err != nil {
		t.Fatalf("UpdateListRow: %v", err)
	}
}

func TestListCellUndo_RestoresPreviousAndRedoRestoresNext(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt", "qty": "1"})
	rowID := h.rows(t)[0].ID

	h.writeCell(t, rowID, "name", "Nut")
	if got := h.cell(t, "name"); got != "Nut" {
		t.Fatalf("after edit name = %q, want Nut", got)
	}

	if res := h.atlas.Undo(); !res.Applied || res.Skipped {
		t.Fatalf("Undo = %+v, want applied and not skipped", res)
	}
	if got := h.cell(t, "name"); got != "Bolt" {
		t.Errorf("after undo name = %q, want Bolt", got)
	}
	if got := h.cell(t, "qty"); got != "1" {
		t.Errorf("undo touched a neighbouring cell: qty = %q, want 1", got)
	}

	if res := h.atlas.Redo(); !res.Applied || res.Skipped {
		t.Fatalf("Redo = %+v, want applied and not skipped", res)
	}
	if got := h.cell(t, "name"); got != "Nut" {
		t.Errorf("after redo name = %q, want Nut", got)
	}
}

func TestListCellUndo_ConsecutiveEditsToOneCellAreOneStep(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt"})
	rowID := h.rows(t)[0].ID

	for _, v := range []string{"B", "Bo", "Bol", "Screw"} {
		h.writeCell(t, rowID, "name", v)
	}

	if res := h.atlas.Undo(); !res.Applied {
		t.Fatalf("Undo = %+v, want applied", res)
	}
	if got := h.cell(t, "name"); got != "Bolt" {
		t.Errorf("after one undo name = %q, want Bolt (four commits to one cell fold into one step)", got)
	}
	if res := h.atlas.Redo(); !res.Applied {
		t.Fatalf("Redo = %+v, want applied", res)
	}
	if got := h.cell(t, "name"); got != "Screw" {
		t.Errorf("after redo name = %q, want Screw (the last value committed)", got)
	}
}

func TestListCellUndo_ADifferentCellIsItsOwnStep(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt", "qty": "1"})
	rowID := h.rows(t)[0].ID

	h.writeCell(t, rowID, "name", "Nut")
	h.writeCell(t, rowID, "qty", "7")

	h.atlas.Undo()
	if got := h.cell(t, "qty"); got != "1" {
		t.Errorf("first undo: qty = %q, want 1", got)
	}
	if got := h.cell(t, "name"); got != "Nut" {
		t.Errorf("first undo reached past its own cell: name = %q, want Nut", got)
	}
	h.atlas.Undo()
	if got := h.cell(t, "name"); got != "Bolt" {
		t.Errorf("second undo: name = %q, want Bolt", got)
	}
}

func TestListRowUndo_WideWriteRestoresEveryColumn(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt", "qty": "1"})
	rowID := h.rows(t)[0].ID

	if _, err := h.cfg.UpdateListRow(h.list.ID, rowID, map[string]string{"name": "Nut", "qty": "9"}, list.RowActive); err != nil {
		t.Fatalf("UpdateListRow: %v", err)
	}
	if res := h.atlas.Undo(); !res.Applied || res.Skipped {
		t.Fatalf("Undo = %+v", res)
	}
	if name, qty := h.cell(t, "name"), h.cell(t, "qty"); name != "Bolt" || qty != "1" {
		t.Errorf("after undo (name, qty) = (%q, %q), want (Bolt, 1)", name, qty)
	}
}

func TestListRowUndo_InsertRoundTrips(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "first"}, map[string]string{"name": "last"})

	if _, err := h.cfg.AddListRowAt(h.list.ID, map[string]string{"name": "middle"}, 1); err != nil {
		t.Fatalf("AddListRowAt: %v", err)
	}
	if got := len(h.rows(t)); got != 3 {
		t.Fatalf("rows = %d, want 3", got)
	}

	h.atlas.Undo()
	names := rowNames(h.rows(t))
	if strings.Join(names, ",") != "first,last" {
		t.Errorf("after undo rows = %v, want [first last]", names)
	}

	h.atlas.Redo()
	names = rowNames(h.rows(t))
	if strings.Join(names, ",") != "first,middle,last" {
		t.Errorf("after redo rows = %v, want [first middle last]", names)
	}
}

func TestListRowUndo_DeleteRestoresTheWholeRowAtItsIndex(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "first"}, map[string]string{"name": "middle", "qty": "3"}, map[string]string{"name": "last"})
	target := h.rows(t)[1]

	if _, err := h.cfg.DeleteListRow(h.list.ID, target.ID); err != nil {
		t.Fatalf("DeleteListRow: %v", err)
	}
	h.atlas.Undo()

	rows := h.rows(t)
	if names := rowNames(rows); strings.Join(names, ",") != "first,middle,last" {
		t.Fatalf("after undo rows = %v, want [first middle last]", names)
	}
	if rows[1].ID != target.ID {
		t.Errorf("restored row id = %q, want the deleted row's own id %q", rows[1].ID, target.ID)
	}
	if rows[1].Values["qty"] != "3" {
		t.Errorf("restored row lost a column: qty = %q, want 3", rows[1].Values["qty"])
	}

	h.atlas.Redo()
	if names := rowNames(h.rows(t)); strings.Join(names, ",") != "first,last" {
		t.Errorf("after redo rows = %v, want [first last]", names)
	}
}

func TestListCellUndo_SkipsWithANoticeWhenTheRowIsGone(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt"})
	rowID := h.rows(t)[0].ID

	h.writeCell(t, rowID, "name", "Nut")
	// The row leaves through the unrecorded core, so the cell entry is
	// still the newest thing on the journal when Undo pops it.
	if _, err := h.cfg.deleteListRow(h.list.ID, rowID); err != nil {
		t.Fatalf("deleteListRow: %v", err)
	}

	res := h.atlas.Undo()
	if !res.Applied || !res.Skipped {
		t.Fatalf("Undo = %+v, want applied and skipped", res)
	}
	if !strings.Contains(res.Message, "Undo test") {
		t.Errorf("skip notice = %q, want it to name the list", res.Message)
	}
}

func TestListCellUndo_SkipsWhenTheColumnWasRemoved(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt", "qty": "1"})
	rowID := h.rows(t)[0].ID

	h.writeCell(t, rowID, "qty", "9")
	if _, err := h.cfg.UpdateList(h.list.ID, h.list.Label, "", []typedfield.Field{
		{Key: "name", Label: "Name", Type: typedfield.TypeText},
	}, []typedfield.FieldTombstone{{Key: "qty", Type: typedfield.TypeText}}); err != nil {
		t.Fatalf("UpdateList: %v", err)
	}

	res := h.atlas.Undo()
	if !res.Applied || !res.Skipped {
		t.Errorf("Undo = %+v, want applied and skipped", res)
	}
}

func TestListRowUndo_SyncExpiryLeavesNoUndoStep(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt"})

	if _, err := h.cfg.SyncListRows(h.list.ID, "name", []map[string]string{{"name": "Nut"}}, true); err != nil {
		t.Fatalf("SyncListRows: %v", err)
	}
	if h.atlas.UndoState().HasUndo {
		t.Error("a list sync left a step on the user's undo journal")
	}
}

func TestListRowUndo_SeedingAndCompositionWritesLeaveNoUndoStep(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt"})

	if _, err := h.cfg.AddListRow(h.list.ID, map[string]string{"name": "appended"}); err != nil {
		t.Fatalf("AddListRow: %v", err)
	}
	if _, err := h.cfg.ApplyListRow(h.list.ID, "name", map[string]string{"name": "Bolt", "qty": "4"}); err != nil {
		t.Fatalf("ApplyListRow: %v", err)
	}
	if h.atlas.UndoState().HasUndo {
		t.Error("an in-process composition write left a step on the user's undo journal")
	}
}

// One journal, in order: the board's own entry recorded BEFORE a cell
// edit undoes second -- ⌘Z after typing in a table's cell restores the
// cell and leaves the table alone (goal 0352's reported defect).
func TestListCellUndo_UndoesBeforeTheBoardEntryUnderIt(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt"})
	rowID := h.rows(t)[0].ID

	kind, err := h.atlas.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	card, err := h.atlas.CreateCard(kind.ID, "Table card", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	h.writeCell(t, rowID, "name", "Nut")

	if res := h.atlas.Undo(); !res.Applied || res.Skipped {
		t.Fatalf("first Undo = %+v", res)
	}
	if got := h.cell(t, "name"); got != "Bolt" {
		t.Errorf("first undo: name = %q, want Bolt", got)
	}
	if !hasCard(h.atlas, card.ID) {
		t.Fatal("the first undo removed the card instead of undoing the cell edit")
	}

	if res := h.atlas.Undo(); !res.Applied {
		t.Fatalf("second Undo = %+v", res)
	}
	if hasCard(h.atlas, card.ID) {
		t.Error("the second undo left the card in place")
	}
}

func hasCard(a *atlassvc.AtlasService, id string) bool {
	for _, c := range a.Cards() {
		if c.ID == id {
			return true
		}
	}
	return false
}

func rowNames(rows []list.Row) []string {
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.Values["name"])
	}
	return out
}
