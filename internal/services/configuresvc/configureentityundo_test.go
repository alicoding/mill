package configuresvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// Goal 0352 part 2: a List's schema write and a Configure entity's
// delete walk the SAME actor-scoped journal the row edits do
// (ADR-0044's amendment). These pin the new families' properties: a
// schema edit is a columns/tombstones delta (never a whole-record
// snapshot), undoing a column removal restores the column AND the
// values rows kept under its tombstone, consecutive renames of one
// column fold into one step, and an entity delete restores the record
// with its own id and rows, then redoes as a delete again.

func TestListSchemaUndo_RenameRoundTrips(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt", "qty": "1"})

	if _, err := h.cfg.UpdateList(h.list.ID, h.list.Label, "", []typedfield.Field{
		{Key: "name", Label: "Part", Type: typedfield.TypeText},
		{Key: "qty", Label: "Qty", Type: typedfield.TypeText},
	}, nil); err != nil {
		t.Fatalf("UpdateList: %v", err)
	}

	if res := h.atlas.Undo(); !res.Applied || res.Skipped {
		t.Fatalf("Undo = %+v, want applied and not skipped", res)
	}
	if got := h.columns(t)[0].Label; got != "Name" {
		t.Errorf("after undo first column label = %q, want Name", got)
	}
	if res := h.atlas.Redo(); !res.Applied || res.Skipped {
		t.Fatalf("Redo = %+v, want applied and not skipped", res)
	}
	if got := h.columns(t)[0].Label; got != "Part" {
		t.Errorf("after redo first column label = %q, want Part", got)
	}
}

func TestListSchemaUndo_ConsecutiveRenamesOfOneColumnAreOneStep(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt"})

	for _, label := range []string{"N", "Na", "Part"} {
		if _, err := h.cfg.UpdateList(h.list.ID, h.list.Label, "", []typedfield.Field{
			{Key: "name", Label: label, Type: typedfield.TypeText},
			{Key: "qty", Label: "Qty", Type: typedfield.TypeText},
		}, nil); err != nil {
			t.Fatalf("UpdateList: %v", err)
		}
	}

	if res := h.atlas.Undo(); !res.Applied {
		t.Fatalf("Undo = %+v, want applied", res)
	}
	if got := h.columns(t)[0].Label; got != "Name" {
		t.Errorf("after one undo first column label = %q, want Name (three renames to one column fold into one step)", got)
	}
	if h.atlas.UndoState().HasUndo {
		t.Error("a second step survived the fold — one undo already walked back to the original label")
	}
}

func TestListSchemaUndo_InsertRoundTrips(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt"})

	if _, err := h.cfg.UpdateList(h.list.ID, h.list.Label, "", []typedfield.Field{
		{Key: "name", Label: "Name", Type: typedfield.TypeText},
		{Key: "qty", Label: "Qty", Type: typedfield.TypeText},
		{Key: "bin", Label: "Bin", Type: typedfield.TypeText},
	}, nil); err != nil {
		t.Fatalf("UpdateList: %v", err)
	}
	if got := len(h.columns(t)); got != 3 {
		t.Fatalf("columns = %d, want 3", got)
	}

	h.atlas.Undo()
	if got := len(h.columns(t)); got != 2 {
		t.Errorf("after undo columns = %d, want 2", got)
	}
	h.atlas.Redo()
	if got := h.columns(t); len(got) != 3 || got[2].Key != "bin" {
		t.Errorf("after redo columns = %v, want the bin column back third", columnKeys(got))
	}
}

func TestListSchemaUndo_RemovalRestoresTheColumnAndItsValues(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt", "qty": "42"})

	// The grid's own removal door: drop the column, tombstone its key.
	if _, err := h.cfg.UpdateList(h.list.ID, h.list.Label, "", []typedfield.Field{
		{Key: "name", Label: "Name", Type: typedfield.TypeText},
	}, []typedfield.FieldTombstone{{Key: "qty", Type: typedfield.TypeText}}); err != nil {
		t.Fatalf("UpdateList: %v", err)
	}
	if got := len(h.columns(t)); got != 1 {
		t.Fatalf("after removal columns = %d, want 1", got)
	}

	if res := h.atlas.Undo(); !res.Applied || res.Skipped {
		t.Fatalf("Undo = %+v, want applied and not skipped", res)
	}
	if got := h.columns(t); len(got) != 2 || got[1].Key != "qty" {
		t.Fatalf("after undo columns = %v, want the qty column back second", columnKeys(got))
	}
	if got := h.cell(t, "qty"); got != "42" {
		t.Errorf("after undo qty = %q, want 42 (rows kept the value under the tombstone)", got)
	}
	if got := len(h.listState(t).FieldTombstones); got != 0 {
		t.Errorf("after undo tombstones = %d, want 0 (undo drops the tombstone, not the value)", got)
	}

	if res := h.atlas.Redo(); !res.Applied || res.Skipped {
		t.Fatalf("Redo = %+v, want applied and not skipped", res)
	}
	if got := len(h.columns(t)); got != 1 {
		t.Errorf("after redo columns = %d, want 1", got)
	}
	if got := len(h.listState(t).FieldTombstones); got != 1 {
		t.Errorf("after redo tombstones = %d, want 1", got)
	}
}

func TestListSchemaUndo_LabelOnlySaveJournalsNothing(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt"})

	if _, err := h.cfg.UpdateList(h.list.ID, "Renamed list", "", h.listState(t).Columns, nil); err != nil {
		t.Fatalf("UpdateList: %v", err)
	}
	if h.atlas.UndoState().HasUndo {
		t.Error("a label-only list save left a step on the undo journal — the entry is the schema delta alone")
	}
}

func TestConfigureEntityUndo_ListDeleteRestoresWithItsOwnIDAndRedeletes(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt", "qty": "1"})

	if err := h.cfg.DeleteList(h.list.ID); err != nil {
		t.Fatalf("DeleteList: %v", err)
	}
	if h.atlas.UndoState().TopKind != "configure-entity" || h.atlas.UndoState().TopID != "list/"+h.list.ID {
		t.Errorf("UndoState top = %s/%s, want configure-entity/list/%s", h.atlas.UndoState().TopKind, h.atlas.UndoState().TopID, h.list.ID)
	}

	if res := h.atlas.Undo(); !res.Applied || res.Skipped {
		t.Fatalf("Undo = %+v, want applied and not skipped", res)
	}
	restored, err := h.cfg.GetList(h.list.ID)
	if err != nil {
		t.Fatalf("GetList after undo: %v", err)
	}
	if restored.Label != h.list.Label {
		t.Errorf("restored label = %q, want %q", restored.Label, h.list.Label)
	}
	if names := rowNames(restored.Rows); strings.Join(names, ",") != "Bolt" {
		t.Errorf("restored rows = %v, want [Bolt]", names)
	}

	if res := h.atlas.Redo(); !res.Applied || res.Skipped {
		t.Fatalf("Redo = %+v, want applied and not skipped", res)
	}
	if _, err := h.cfg.GetList(h.list.ID); err == nil {
		t.Error("after redo the list is back — the redo did not re-delete")
	}
}

func TestConfigureEntityUndo_DecisionDeleteRoundTrips(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt"})

	d, err := h.cfg.CreateDecision("Gate", decision.CategoryApprove, nil, "")
	if err != nil {
		t.Fatalf("CreateDecision: %v", err)
	}
	if err := h.cfg.DeleteDecision(d.ID); err != nil {
		t.Fatalf("DeleteDecision: %v", err)
	}

	if res := h.atlas.Undo(); !res.Applied || res.Skipped {
		t.Fatalf("Undo = %+v, want applied and not skipped", res)
	}
	for _, got := range h.cfg.Decisions() {
		if got.ID == d.ID {
			goto restored
		}
	}
	t.Fatalf("after undo no decision with id %q — the delete did not restore with its own id", d.ID)

restored:
	if res := h.atlas.Redo(); !res.Applied || res.Skipped {
		t.Fatalf("Redo = %+v, want applied and not skipped", res)
	}
	for _, got := range h.cfg.Decisions() {
		if got.ID == d.ID {
			t.Error("after redo the decision is back — the redo did not re-delete")
		}
	}
}

// The list-schema and configure-entity families sit in ONE journal with
// the row families: four gestures (rename a column, delete a row,
// delete the list) pop in exact reverse order, and the fourth ⌘Z finds
// an empty stack.
func TestUndoJournal_FamilyPairPopsInReverseOrder(t *testing.T) {
	h := newUndoHarness(t, map[string]string{"name": "Bolt", "qty": "1"}, map[string]string{"name": "Nut", "qty": "2"})
	rowID := h.rows(t)[1].ID

	if _, err := h.cfg.UpdateList(h.list.ID, h.list.Label, "", []typedfield.Field{
		{Key: "name", Label: "Part", Type: typedfield.TypeText},
		{Key: "qty", Label: "Qty", Type: typedfield.TypeText},
	}, nil); err != nil {
		t.Fatalf("rename column: %v", err)
	}
	if _, err := h.cfg.DeleteListRow(h.list.ID, rowID); err != nil {
		t.Fatalf("delete row: %v", err)
	}
	if err := h.cfg.DeleteList(h.list.ID); err != nil {
		t.Fatalf("delete list: %v", err)
	}

	if res := h.atlas.Undo(); !res.Applied || res.Skipped {
		t.Fatalf("undo 1 (list) = %+v", res)
	}
	if _, err := h.cfg.GetList(h.list.ID); err != nil {
		t.Fatalf("after undo 1 the list is still gone: %v", err)
	}

	if res := h.atlas.Undo(); !res.Applied || res.Skipped {
		t.Fatalf("undo 2 (row) = %+v", res)
	}
	if names := rowNames(h.rows(t)); strings.Join(names, ",") != "Bolt,Nut" {
		t.Errorf("after undo 2 rows = %v, want [Bolt Nut]", names)
	}

	if res := h.atlas.Undo(); !res.Applied || res.Skipped {
		t.Fatalf("undo 3 (rename) = %+v", res)
	}
	if got := h.columns(t)[0].Label; got != "Name" {
		t.Errorf("after undo 3 first column label = %q, want Name", got)
	}

	if res := h.atlas.Undo(); res.Applied {
		t.Error("undo 4 applied — the journal should be empty after three steps walked back")
	}
}

func (h undoHarness) listState(t *testing.T) (l struct {
	Columns         []typedfield.Field
	FieldTombstones []typedfield.FieldTombstone
}) {
	t.Helper()
	got, err := h.cfg.GetList(h.list.ID)
	if err != nil {
		t.Fatalf("GetList: %v", err)
	}
	l.Columns = got.Columns
	l.FieldTombstones = got.FieldTombstones
	return l
}

func (h undoHarness) columns(t *testing.T) []typedfield.Field {
	t.Helper()
	return h.listState(t).Columns
}

func columnKeys(fields []typedfield.Field) []string {
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		out = append(out, f.Key)
	}
	return out
}
