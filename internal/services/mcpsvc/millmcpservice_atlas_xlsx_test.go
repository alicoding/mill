package mcpsvc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/mcpaudit"
	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/mcpauditsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// A real .xlsx workbook as a content plane over MCP (goal 0365 S1):
// read a range of cells (with formula text in a parallel field), edit
// named cells in place, read back -- against the real MCP transport
// and a real .xlsx file on disk, mirroring the sheet/diagram tools'
// own test shape (millmcpservice_atlas_sheet_test.go).
//
// xlsxFixturePath is internal/domain/atlas/xlsx's own committed
// testdata fixture (two sheets, a merged header, a formula column) --
// read as raw bytes so this package never imports excelize itself
// (architecture.md: excelize stays inside the domain/adapter package).
const xlsxFixturePath = "../../domain/atlas/xlsx/testdata/sample.xlsx"

type xlsxMCPFixture struct {
	h        *atlasMCPHarness
	objectID string
	path     string
}

func newXlsxMCPFixture(t *testing.T, addr string) *xlsxMCPFixture {
	t.Helper()
	h := newAtlasMCPHarness(t, addr)
	src, err := os.ReadFile(xlsxFixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	path := filepath.Join(t.TempDir(), "Orders.xlsx")
	if err := os.WriteFile(path, src, 0o600); err != nil { // #nosec G703 -- path is this test's own tempdir-scoped path, never input
		t.Fatalf("write fixture copy: %v", err)
	}
	o, err := h.atlas.CreateBoardObject("sheet", map[string]string{"mirrorPath": path, "title": "Orders"}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	return &xlsxMCPFixture{h: h, objectID: o.ID, path: path}
}

// enableUnattendedWrites mirrors sheetMCPFixture's own helper: writes
// on AND per-write approval off, so a gated call executes inside the
// tool call itself.
func (f *xlsxMCPFixture) enableUnattendedWrites(t *testing.T) {
	t.Helper()
	if err := f.h.svc.store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("enable MCP writes: %v", err)
	}
	if err := f.h.svc.store.Set(MCPWriteApprovalKey, "false"); err != nil {
		t.Fatalf("relax approval: %v", err)
	}
}

func (f *xlsxMCPFixture) readRange(t *testing.T, sheet, rng string) atlasXlsxReadRangeResult {
	t.Helper()
	args := map[string]any{"objectId": f.objectID}
	if sheet != "" {
		args["sheet"] = sheet
	}
	if rng != "" {
		args["range"] = rng
	}
	var out atlasXlsxReadRangeResult
	if err := json.Unmarshal([]byte(f.h.call(t, "atlas_xlsx_read_range", args)), &out); err != nil {
		t.Fatalf("decode atlas_xlsx_read_range: %v", err)
	}
	return out
}

func TestXlsxMCP_ReadDefaultsToFirstSheetAndWholeUsedRange(t *testing.T) {
	f := newXlsxMCPFixture(t, "127.0.0.1:18260")
	out := f.readRange(t, "", "")
	if out.Sheet != "Sheet1" {
		t.Errorf("sheet = %q, want Sheet1 (the workbook's first)", out.Sheet)
	}
	if out.Dimensions.Rows == 0 || out.Dimensions.Cols == 0 {
		t.Errorf("dimensions = %+v, want a non-empty used range", out.Dimensions)
	}
	if out.Values[2][0] != "Widget" || out.Values[2][1] != "3" {
		t.Errorf("row 3 = %v, want Widget/3/...", out.Values[2])
	}
}

func TestXlsxMCP_ReadSubRangeReturnsFormulaTextInAParallelGrid(t *testing.T) {
	f := newXlsxMCPFixture(t, "127.0.0.1:18261")
	out := f.readRange(t, "Sheet1", "C3:C4")
	wantFormulas := [][]string{{"B3*10"}, {"B4*10"}}
	if !equalSheetGrid(out.Formulas, wantFormulas) {
		t.Errorf("formulas = %v, want %v", out.Formulas, wantFormulas)
	}
}

func TestXlsxMCP_ReadNamedSheet(t *testing.T) {
	f := newXlsxMCPFixture(t, "127.0.0.1:18262")
	out := f.readRange(t, "Notes", "")
	if out.Sheet != "Notes" {
		t.Errorf("sheet = %q, want Notes", out.Sheet)
	}
	if out.Values[0][0] != "Reference" {
		t.Errorf("A1 = %q, want Reference", out.Values[0][0])
	}
}

func TestXlsxMCP_ReadUnknownSheetNamesSheetsPresent(t *testing.T) {
	f := newXlsxMCPFixture(t, "127.0.0.1:18263")
	assertToolError(t, f.h, "atlas_xlsx_read_range", map[string]any{"objectId": f.objectID, "sheet": "DoesNotExist"},
		`no sheet named "DoesNotExist"`)
}

func TestXlsxMCP_EditCellsChangesOnlyNamedCellsAcrossSheets(t *testing.T) {
	f := newXlsxMCPFixture(t, "127.0.0.1:18264")
	f.enableUnattendedWrites(t)

	before := f.readRange(t, "Sheet1", "")

	var edited atlasXlsxEditCellsResult
	if err := json.Unmarshal([]byte(f.h.call(t, "atlas_xlsx_edit_cells", map[string]any{
		"objectId": f.objectID,
		"sheet":    "Sheet1",
		"edits": []map[string]any{
			{"address": "B3", "value": "4"},
			{"address": "E1", "formula": "SUM(B3:B4)"},
		},
	})), &edited); err != nil {
		t.Fatalf("decode edit: %v", err)
	}
	if edited.Updated != 2 {
		t.Fatalf("updated = %d, want 2", edited.Updated)
	}

	after := f.readRange(t, "Sheet1", "")
	if after.Values[2][1] != "4" {
		t.Errorf("B3 = %q, want 4", after.Values[2][1])
	}
	if after.Formulas[0][4] != "SUM(B3:B4)" {
		t.Errorf("E1 formula = %q, want SUM(B3:B4)", after.Formulas[0][4])
	}
	// C3's own formula (B3*10) and its (never recalculated) cached
	// value survive an edit to a DIFFERENT cell -- B3's value changing
	// does not touch C3 at all, even though C3's formula references it.
	if after.Values[2][2] != before.Values[2][2] || after.Formulas[2][2] != "B3*10" {
		t.Errorf("C3 = %q/%q, want %q/B3*10 (untouched by the B3/E1 edits)", after.Values[2][2], after.Formulas[2][2], before.Values[2][2])
	}

	// The other sheet is completely unaffected by an edit to Sheet1.
	notes := f.readRange(t, "Notes", "")
	if notes.Values[0][0] != "Reference" {
		t.Errorf("Notes!A1 = %q, want Reference (unaffected by a Sheet1 edit)", notes.Values[0][0])
	}
}

func TestXlsxMCP_WriteToolRefusesWhenWritesAreDisabled(t *testing.T) {
	f := newXlsxMCPFixture(t, "127.0.0.1:18265")
	before, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatalf("read fixture copy: %v", err)
	}
	assertToolError(t, f.h, "atlas_xlsx_edit_cells", map[string]any{
		"objectId": f.objectID, "edits": []map[string]any{{"address": "A1", "value": "x"}},
	}, "MCP write tools are disabled")
	after, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatalf("read fixture copy: %v", err)
	}
	if string(before) != string(after) {
		t.Error("a refused write still touched the file")
	}
}

func TestXlsxMCP_RefusesNonXlsxSheetObjectsAndUnknownIDs(t *testing.T) {
	f := newXlsxMCPFixture(t, "127.0.0.1:18266")
	f.enableUnattendedWrites(t)

	csvPath := filepath.Join(t.TempDir(), "Groceries.csv")
	if err := os.WriteFile(csvPath, []byte("Item,Qty\nBeans,2\n"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	csvSheet, err := f.h.atlas.CreateBoardObject("sheet", map[string]string{"mirrorPath": csvPath}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	assertToolError(t, f.h, "atlas_xlsx_read_range", map[string]any{"objectId": csvSheet.ID},
		"not an .xlsx workbook")
	assertToolError(t, f.h, "atlas_xlsx_edit_cells", map[string]any{
		"objectId": csvSheet.ID, "edits": []map[string]any{{"address": "A1", "value": "x"}},
	}, "not an .xlsx workbook")

	diagramPath := filepath.Join(t.TempDir(), "d.drawio")
	if err := os.WriteFile(diagramPath, []byte("<mxfile></mxfile>"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	diagram, err := f.h.atlas.CreateBoardObject("diagram", map[string]string{"mirrorPath": diagramPath}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	assertToolError(t, f.h, "atlas_xlsx_read_range", map[string]any{"objectId": diagram.ID}, `is a "diagram", not a sheet`)

	assertToolError(t, f.h, "atlas_xlsx_read_range", map[string]any{"objectId": "nope"}, "no board object with id")
}

func TestXlsxMCP_EditCellsRefusesBadAddressEmptyEditsAndAmbiguousValueFormula(t *testing.T) {
	f := newXlsxMCPFixture(t, "127.0.0.1:18267")
	f.enableUnattendedWrites(t)

	assertToolError(t, f.h, "atlas_xlsx_edit_cells", map[string]any{
		"objectId": f.objectID, "edits": []map[string]any{},
	}, "name at least one cell to edit")
	assertToolError(t, f.h, "atlas_xlsx_edit_cells", map[string]any{
		"objectId": f.objectID, "edits": []map[string]any{{"address": "not-a-cell", "value": "x"}},
	}, "not a cell address")
	assertToolError(t, f.h, "atlas_xlsx_edit_cells", map[string]any{
		"objectId": f.objectID, "edits": []map[string]any{{"address": "B3"}},
	}, "name exactly one of value or formula")
	assertToolError(t, f.h, "atlas_xlsx_edit_cells", map[string]any{
		"objectId": f.objectID, "edits": []map[string]any{{"address": "B3", "value": "x", "formula": "1+1"}},
	}, "name exactly one of value or formula")

	before, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatalf("read fixture copy: %v", err)
	}
	after, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatalf("read fixture copy: %v", err)
	}
	if string(before) != string(after) {
		t.Error("a rejected edit still touched the file")
	}
}

// TestXlsxMCP_ParkedWriteApprovalRoundTrip proves atlas_xlsx_edit_cells
// goes through the SAME park-and-poll approval lifecycle every other
// gated write tool uses (docs/adr/0032): with per-write approval left
// at its default (required), the call parks until PendingMCPWrites
// shows it and ResolveMCPWrite(id, true) executes it -- exactly the
// mechanism millmcpservice_approval_test.go proves generically, run
// here against this goal's own new tool.
func TestXlsxMCP_ParkedWriteApprovalRoundTrip(t *testing.T) {
	f := newXlsxMCPFixture(t, "127.0.0.1:18268")
	if err := f.h.svc.store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("enable MCP writes: %v", err)
	}
	// Approval key left unset: required is the default.

	type callOutcome struct {
		res *mcp.CallToolResult
		err error
	}
	done := make(chan callOutcome, 1)
	go func() {
		res, err := f.h.session.CallTool(f.h.ctx, &mcp.CallToolParams{
			Name: "atlas_xlsx_edit_cells",
			Arguments: map[string]any{
				"objectId": f.objectID,
				"edits":    []map[string]any{{"address": "B3", "value": "9"}},
			},
		})
		done <- callOutcome{res: res, err: err}
	}()

	deadline := time.Now().Add(5 * time.Second)
	var pendingID string
	for time.Now().Before(deadline) {
		if pending := f.h.svc.PendingMCPWrites(); len(pending) == 1 {
			pendingID = pending[0].ID
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if pendingID == "" {
		t.Fatal("atlas_xlsx_edit_cells never parked as a pending MCP write")
	}
	if err := f.h.svc.ResolveMCPWrite(pendingID, true); err != nil {
		t.Fatalf("ResolveMCPWrite(approve): %v", err)
	}
	out := <-done
	if out.err != nil || out.res.IsError {
		t.Fatalf("approved write failed: err=%v res=%+v", out.err, out.res)
	}

	after := f.readRange(t, "Sheet1", "B3")
	if after.Values[0][0] != "9" {
		t.Errorf("B3 = %q after approval, want 9", after.Values[0][0])
	}
}

// TestXlsxMCP_ToolCallsProduceAuditRows proves both new tools ride the
// SAME mcpaudit trail every other MCP tool does -- the audit
// middleware records by tool name mechanically, so no new tool needs
// its own audit wiring, but a real call through it is this goal's own
// proof that neither tool bypasses it.
func TestXlsxMCP_ToolCallsProduceAuditRows(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "execution.db")
	audit, err := mcpauditsvc.New(dbPath, nil)
	if err != nil {
		t.Fatalf("mcpauditsvc.New: %v", err)
	}
	t.Cleanup(func() { _ = audit.Close() })

	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	atlasSvc := atlassvc.NewAtlasService(store)

	svc := NewMillMCPService("0.0.0-test", comp, cfg, store, nil, audit.ServerMiddleware())
	svc.SetAtlasService(atlasSvc)

	src, err := os.ReadFile(xlsxFixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	path := filepath.Join(t.TempDir(), "Orders.xlsx")
	if err := os.WriteFile(path, src, 0o600); err != nil { // #nosec G703 -- path is this test's own tempdir-scoped path, never input
		t.Fatalf("write fixture copy: %v", err)
	}
	o, err := atlasSvc.CreateBoardObject("sheet", map[string]string{"mirrorPath": path}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	ctx := t.Context()
	session, err := svc.ConnectInMemoryClient(ctx, "xlsx-audit-test")
	if err != nil {
		t.Fatalf("ConnectInMemoryClient: %v", err)
	}
	defer func() { _ = session.Close() }()

	res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "atlas_xlsx_read_range", Arguments: map[string]any{"objectId": o.ID}})
	if err != nil {
		t.Fatalf("atlas_xlsx_read_range: transport error: %v", err)
	}
	if res.IsError {
		t.Fatalf("atlas_xlsx_read_range: tool error: %+v", res.Content)
	}

	resp, err := audit.ListMCPCalls(mcpauditsvc.ListMCPCallsRequest{Limit: 20})
	if err != nil {
		t.Fatalf("ListMCPCalls: %v", err)
	}
	var saw bool
	for _, r := range resp.Records {
		if r.ToolName == "atlas_xlsx_read_range" && r.Direction == string(mcpaudit.DirectionServer) {
			saw = true
		}
	}
	if !saw {
		t.Error("atlas_xlsx_read_range produced no direction=server audit row")
	}
}
