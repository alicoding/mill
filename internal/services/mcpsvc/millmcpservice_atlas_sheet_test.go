package mcpsvc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// A sheet as a content plane over MCP (goal 0388): read a range of
// cells, edit named cells in place, read back -- against the real MCP
// transport and the real CSV file on disk, mirroring the diagram
// tools' own test shape (millmcpservice_atlas_diagram_test.go).

const sheetMCPSource = "Item,Qty,Notes\nBeans,2,\nRice,5,bulk\n"

type sheetMCPFixture struct {
	h        *atlasMCPHarness
	objectID string
	path     string
}

func newSheetMCPFixture(t *testing.T, addr string) *sheetMCPFixture {
	t.Helper()
	h := newAtlasMCPHarness(t, addr)
	path := filepath.Join(t.TempDir(), "Groceries.csv")
	if err := os.WriteFile(path, []byte(sheetMCPSource), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	o, err := h.atlas.CreateBoardObject("sheet", map[string]string{"mirrorPath": path, "title": "Groceries"}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	return &sheetMCPFixture{h: h, objectID: o.ID, path: path}
}

// enableUnattendedWrites turns writes on AND turns per-write approval
// off, so a gated call executes inside the tool call itself -- the
// same knob diagramMCPFixture.enableUnattendedWrites uses
// (millmcpservice_atlas_diagram_test.go).
func (f *sheetMCPFixture) enableUnattendedWrites(t *testing.T) {
	t.Helper()
	if err := f.h.svc.store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("enable MCP writes: %v", err)
	}
	if err := f.h.svc.store.Set(MCPWriteApprovalKey, "false"); err != nil {
		t.Fatalf("relax approval: %v", err)
	}
}

func (f *sheetMCPFixture) fileOnDisk(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	return string(data)
}

func (f *sheetMCPFixture) readRange(t *testing.T, rng string) atlasSheetReadRangeResult {
	t.Helper()
	args := map[string]any{"objectId": f.objectID}
	if rng != "" {
		args["range"] = rng
	}
	var out atlasSheetReadRangeResult
	if err := json.Unmarshal([]byte(f.h.call(t, "atlas_sheet_read_range", args)), &out); err != nil {
		t.Fatalf("decode atlas_sheet_read_range: %v", err)
	}
	return out
}

func TestSheetMCP_ReadWholeSheet(t *testing.T) {
	f := newSheetMCPFixture(t, "127.0.0.1:18240")
	out := f.readRange(t, "")
	if out.Range != "A1:C3" {
		t.Errorf("range = %q, want A1:C3", out.Range)
	}
	if out.Dimensions != (atlasSheetDimensionsOut{Rows: 3, Cols: 3}) {
		t.Errorf("dimensions = %+v", out.Dimensions)
	}
	want := [][]string{{"Item", "Qty", "Notes"}, {"Beans", "2", ""}, {"Rice", "5", "bulk"}}
	if !equalSheetGrid(out.Values, want) {
		t.Errorf("values = %v, want %v", out.Values, want)
	}
}

func TestSheetMCP_ReadSubRange(t *testing.T) {
	f := newSheetMCPFixture(t, "127.0.0.1:18241")
	out := f.readRange(t, "A2:B3")
	if out.Range != "A2:B3" {
		t.Errorf("range = %q", out.Range)
	}
	want := [][]string{{"Beans", "2"}, {"Rice", "5"}}
	if !equalSheetGrid(out.Values, want) {
		t.Errorf("values = %v, want %v", out.Values, want)
	}
	// Dimensions always report the SHEET's own footprint, not the
	// requested range's.
	if out.Dimensions != (atlasSheetDimensionsOut{Rows: 3, Cols: 3}) {
		t.Errorf("dimensions = %+v, want the sheet's own 3x3 footprint", out.Dimensions)
	}
}

func TestSheetMCP_EditCellsChangesOnlyNamedCells(t *testing.T) {
	f := newSheetMCPFixture(t, "127.0.0.1:18242")
	f.enableUnattendedWrites(t)

	var edited atlasSheetEditCellsResult
	if err := json.Unmarshal([]byte(f.h.call(t, "atlas_sheet_edit_cells", map[string]any{
		"objectId": f.objectID,
		"edits": []map[string]any{
			{"address": "B2", "value": "3"},
			{"address": "C2", "value": "on sale"},
		},
	})), &edited); err != nil {
		t.Fatalf("decode edit: %v", err)
	}
	if edited.Updated != 2 {
		t.Fatalf("updated = %d, want 2", edited.Updated)
	}

	after := f.readRange(t, "")
	want := [][]string{{"Item", "Qty", "Notes"}, {"Beans", "3", "on sale"}, {"Rice", "5", "bulk"}}
	if !equalSheetGrid(after.Values, want) {
		t.Errorf("after edit = %v, want %v (only B2/C2 should have changed)", after.Values, want)
	}
}

func TestSheetMCP_WriteToolRefusesWhenWritesAreDisabled(t *testing.T) {
	f := newSheetMCPFixture(t, "127.0.0.1:18243")
	assertToolError(t, f.h, "atlas_sheet_edit_cells", map[string]any{
		"objectId": f.objectID, "edits": []map[string]any{{"address": "A1", "value": "x"}},
	}, "MCP write tools are disabled")
	if f.fileOnDisk(t) != sheetMCPSource {
		t.Error("a refused write still touched the file")
	}
}

func TestSheetMCP_RefusesNonSheetAndBinarySheetObjects(t *testing.T) {
	f := newSheetMCPFixture(t, "127.0.0.1:18244")
	f.enableUnattendedWrites(t)

	diagramPath := filepath.Join(t.TempDir(), "d.drawio")
	if err := os.WriteFile(diagramPath, []byte("<mxfile></mxfile>"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	diagram, err := f.h.atlas.CreateBoardObject("diagram", map[string]string{"mirrorPath": diagramPath}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	assertToolError(t, f.h, "atlas_sheet_read_range", map[string]any{"objectId": diagram.ID}, `is a "diagram", not a sheet`)

	xlsxPath := filepath.Join(t.TempDir(), "budget.xlsx")
	if err := os.WriteFile(xlsxPath, []byte("binary-ish"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	binSheet, err := f.h.atlas.CreateBoardObject("sheet", map[string]string{"mirrorPath": xlsxPath}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	assertToolError(t, f.h, "atlas_sheet_read_range", map[string]any{"objectId": binSheet.ID}, "only a CSV-backed sheet can be read or edited over MCP")
	assertToolError(t, f.h, "atlas_sheet_edit_cells", map[string]any{
		"objectId": binSheet.ID, "edits": []map[string]any{{"address": "A1", "value": "x"}},
	}, "only a CSV-backed sheet can be read or edited over MCP")

	assertToolError(t, f.h, "atlas_sheet_read_range", map[string]any{"objectId": "nope"}, "no board object with id")
}

func TestSheetMCP_EditCellsRefusesBadAddressAndEmptyEdits(t *testing.T) {
	f := newSheetMCPFixture(t, "127.0.0.1:18245")
	f.enableUnattendedWrites(t)

	assertToolError(t, f.h, "atlas_sheet_edit_cells", map[string]any{
		"objectId": f.objectID, "edits": []map[string]any{},
	}, "name at least one cell to edit")
	assertToolError(t, f.h, "atlas_sheet_edit_cells", map[string]any{
		"objectId": f.objectID, "edits": []map[string]any{{"address": "not-a-cell", "value": "x"}},
	}, "not a cell address")
	if f.fileOnDisk(t) != sheetMCPSource {
		t.Error("a rejected edit still touched the file")
	}
}

func equalSheetGrid(a, b [][]string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if len(a[i]) != len(b[i]) {
			return false
		}
		for j := range a[i] {
			if a[i][j] != b[i][j] {
				return false
			}
		}
	}
	return true
}
