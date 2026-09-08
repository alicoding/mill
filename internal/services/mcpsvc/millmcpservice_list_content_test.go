package mcpsvc

import (
	"encoding/json"
	"testing"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

// list_append_row promoted from a plugin-only door to a first-class
// Mill tool (goal 0388): appends a row to an EXISTING List through the
// same gate every other write tool here uses, against a real List
// entity -- the end-to-end proof, not a Go-level call to AddListRow.

func newTestList(t *testing.T, h *atlasMCPHarness) string {
	t.Helper()
	l, err := h.svc.cfg.CreateListWithRows("Groceries", "", []typedfield.Field{
		{Key: "item", Label: "Item", Type: typedfield.TypeText},
		{Key: "qty", Label: "Qty", Type: typedfield.TypeText},
	}, []map[string]string{{"item": "Beans", "qty": "2"}})
	if err != nil {
		t.Fatalf("CreateListWithRows: %v", err)
	}
	return l.ID
}

func TestListAppendRowMCP_AppendsWithoutTouchingExistingRows(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18250")
	h.enableWrites(t)
	if err := h.svc.store.Set(MCPWriteApprovalKey, "false"); err != nil {
		t.Fatalf("relax approval: %v", err)
	}
	listID := newTestList(t, h)

	var out listAppendRowResult
	if err := json.Unmarshal([]byte(h.call(t, "list_append_row", map[string]any{
		"listId": listID, "row": map[string]any{"item": "Rice", "qty": "5"},
	})), &out); err != nil {
		t.Fatalf("decode list_append_row: %v", err)
	}
	if out.RowID == "" {
		t.Fatal("no rowId returned")
	}

	l, err := h.svc.cfg.GetList(listID)
	if err != nil {
		t.Fatalf("GetList: %v", err)
	}
	if len(l.Rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(l.Rows))
	}
	if l.Rows[0].Values["item"] != "Beans" || l.Rows[0].Values["qty"] != "2" {
		t.Errorf("existing row changed: %+v", l.Rows[0])
	}
	if l.Rows[1].ID != out.RowID || l.Rows[1].Values["item"] != "Rice" || l.Rows[1].Values["qty"] != "5" {
		t.Errorf("appended row = %+v, want Rice/5 at id %s", l.Rows[1], out.RowID)
	}
}

func TestListAppendRowMCP_WriteToolRefusesWhenWritesAreDisabled(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18251")
	listID := newTestList(t, h)
	assertToolError(t, h, "list_append_row", map[string]any{
		"listId": listID, "row": map[string]any{"item": "Rice"},
	}, "MCP write tools are disabled")
}

func TestListAppendRowMCP_RefusesUnknownListAndEmptyRow(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18252")
	h.enableWrites(t)
	assertToolError(t, h, "list_append_row", map[string]any{
		"listId": "no-such-list", "row": map[string]any{"item": "Rice"},
	}, "no list with id")
	listID := newTestList(t, h)
	assertToolError(t, h, "list_append_row", map[string]any{
		"listId": listID, "row": map[string]any{},
	}, "name at least one column value to append")
}
