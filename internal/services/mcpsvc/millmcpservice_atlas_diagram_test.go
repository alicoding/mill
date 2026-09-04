package mcpsvc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/atlas/drawio"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Editing a diagram in place over MCP (goal 0323): read the cells by
// id, add a shape and a connector, rename the shape, delete it (the
// connector goes with it), read back -- against the real MCP transport
// and the real file on disk, so what a client sees and what draw.io
// would open are the same thing.

const diagramMCPSource = `<mxfile host="mill"><diagram id="p1" name="Flow"><mxGraphModel dx="900">` +
	`<root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
	`<mxCell id="a" value="Start" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">` +
	`<mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>` +
	`</root></mxGraphModel></diagram>` +
	`<diagram id="p2" name="Notes"><mxGraphModel dx="10"><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
	`<mxCell id="keep" value="Untouched" vertex="1" parent="1"><mxGeometry x="1" y="1" width="2" height="3" as="geometry"/></mxCell>` +
	`</root></mxGraphModel></diagram></mxfile>`

type diagramMCPFixture struct {
	h        *atlasMCPHarness
	objectID string
	path     string
}

func newDiagramMCPFixture(t *testing.T, addr string) *diagramMCPFixture {
	t.Helper()
	h := newAtlasMCPHarness(t, addr)
	path := filepath.Join(t.TempDir(), "Architecture.drawio")
	if err := os.WriteFile(path, []byte(diagramMCPSource), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	o, err := h.atlas.CreateBoardObject("diagram", map[string]string{"mirrorPath": path, "title": "Architecture"}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	return &diagramMCPFixture{h: h, objectID: o.ID, path: path}
}

// enableUnattendedWrites turns writes on AND turns per-write approval
// off, so a gated call executes inside the tool call itself -- the
// same knob millmcpservice_tools_test.go uses to prove an executor's
// real side effect without driving an approval round trip (the park
// round trip has its own tests).
func (f *diagramMCPFixture) enableUnattendedWrites(t *testing.T) {
	t.Helper()
	if err := f.h.svc.store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("enable MCP writes: %v", err)
	}
	if err := f.h.svc.store.Set(MCPWriteApprovalKey, "false"); err != nil {
		t.Fatalf("relax approval: %v", err)
	}
}

func (f *diagramMCPFixture) read(t *testing.T) atlasReadDiagramResult {
	t.Helper()
	var out atlasReadDiagramResult
	if err := json.Unmarshal([]byte(f.h.call(t, "atlas_read_diagram", map[string]any{"objectId": f.objectID})), &out); err != nil {
		t.Fatalf("decode atlas_read_diagram: %v", err)
	}
	return out
}

func (f *diagramMCPFixture) fileOnDisk(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	return string(data)
}

func TestDiagramMCP_ReadReportsPagesLayersAndCells(t *testing.T) {
	f := newDiagramMCPFixture(t, "127.0.0.1:18140")
	out := f.read(t)
	if out.Format != diagramFormatDrawio {
		t.Fatalf("format = %q", out.Format)
	}
	if len(out.Pages) != 2 || out.Pages[0].Name != "Flow" || out.Pages[1].Name != "Notes" {
		t.Errorf("pages = %+v", out.Pages)
	}
	if out.ActivePage != "p1" {
		t.Errorf("activePage = %q, want the first page", out.ActivePage)
	}
	if len(out.Layers) != 1 || out.Layers[0].ID != "1" {
		t.Errorf("layers = %+v", out.Layers)
	}
	if len(out.Cells) != 1 || out.Cells[0].ID != "a" || out.Cells[0].Label != "Start" || out.Cells[0].Kind != drawio.KindVertex {
		t.Errorf("cells = %+v", out.Cells)
	}
}

func TestDiagramMCP_AddEditDeleteRoundTrip(t *testing.T) {
	f := newDiagramMCPFixture(t, "127.0.0.1:18141")
	f.enableUnattendedWrites(t)

	var added atlasDiagramAddResult
	if err := json.Unmarshal([]byte(f.h.call(t, "atlas_diagram_add_cells", map[string]any{
		"objectId": f.objectID,
		"cells": []map[string]any{
			{"id": "b", "kind": "vertex", "label": "Finish", "geometry": map[string]any{"x": 300, "y": 40}},
			{"kind": "edge", "label": "leads to", "source": "a", "target": "b"},
		},
	})), &added); err != nil {
		t.Fatalf("decode add: %v", err)
	}
	if len(added.IDs) != 2 || added.IDs[0] != "b" || !strings.HasPrefix(added.IDs[1], "mill-") {
		t.Fatalf("ids = %v", added.IDs)
	}
	edgeID := added.IDs[1]

	var edited atlasDiagramEditResult
	if err := json.Unmarshal([]byte(f.h.call(t, "atlas_diagram_edit_cells", map[string]any{
		"objectId": f.objectID,
		"patches":  []map[string]any{{"id": "b", "label": "Done"}},
	})), &edited); err != nil {
		t.Fatalf("decode edit: %v", err)
	}
	if edited.Updated != 1 {
		t.Fatalf("updated = %d", edited.Updated)
	}

	after := f.read(t)
	byID := map[string]drawio.CellOut{}
	for _, c := range after.Cells {
		byID[c.ID] = c
	}
	if byID["b"].Label != "Done" || *byID["b"].Geometry.X != 300 {
		t.Errorf("edited cell = %+v", byID["b"])
	}
	if byID[edgeID].Kind != drawio.KindEdge || byID[edgeID].Source != "a" || byID[edgeID].Target != "b" {
		t.Errorf("edge = %+v", byID[edgeID])
	}

	var deleted atlasDiagramDeleteResult
	if err := json.Unmarshal([]byte(f.h.call(t, "atlas_diagram_delete_cells", map[string]any{
		"objectId": f.objectID, "ids": []string{"b"},
	})), &deleted); err != nil {
		t.Fatalf("decode delete: %v", err)
	}
	if len(deleted.Deleted) != 1 || deleted.Deleted[0] != "b" ||
		len(deleted.EdgesRemoved) != 1 || deleted.EdgesRemoved[0] != edgeID {
		t.Fatalf("deleted=%v edgesRemoved=%v", deleted.Deleted, deleted.EdgesRemoved)
	}

	final := f.read(t)
	if len(final.Cells) != 1 || final.Cells[0].ID != "a" {
		t.Errorf("cells after delete = %+v", final.Cells)
	}
	// The page nobody named came back out of every one of those writes
	// exactly as it went in.
	if !strings.Contains(f.fileOnDisk(t), `<diagram id="p2" name="Notes"><mxGraphModel dx="10">`) ||
		!strings.Contains(f.fileOnDisk(t), `<mxCell id="keep" value="Untouched" vertex="1" parent="1">`) {
		t.Errorf("the untouched page was rewritten:\n%s", f.fileOnDisk(t))
	}
}

func TestDiagramMCP_ImportAddMergesAndNewPageAppends(t *testing.T) {
	f := newDiagramMCPFixture(t, "127.0.0.1:18142")
	f.enableUnattendedWrites(t)

	incoming := `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
		`<mxCell id="a" value="Collides" vertex="1" parent="1"><mxGeometry x="5" y="5" width="10" height="10" as="geometry"/></mxCell>` +
		`</root></mxGraphModel>`

	var merged drawio.ImportResult
	if err := json.Unmarshal([]byte(f.h.call(t, "atlas_diagram_import", map[string]any{
		"objectId": f.objectID, "content": incoming, "mode": "add",
	})), &merged); err != nil {
		t.Fatalf("decode import add: %v", err)
	}
	if merged.Added != 1 || merged.Remapped["a"] == "" {
		t.Fatalf("import add = %+v", merged)
	}
	if got := f.read(t); len(got.Cells) != 2 {
		t.Errorf("cells after merge = %+v", got.Cells)
	}

	var paged drawio.ImportResult
	if err := json.Unmarshal([]byte(f.h.call(t, "atlas_diagram_import", map[string]any{
		"objectId": f.objectID, "content": incoming, "mode": "new-page", "pageName": "Appendix",
	})), &paged); err != nil {
		t.Fatalf("decode import new-page: %v", err)
	}
	if len(paged.Pages) != 1 || paged.Pages[0].Name != "Appendix" {
		t.Fatalf("import new-page = %+v", paged)
	}
	if pages := f.read(t).Pages; len(pages) != 3 || pages[2].Name != "Appendix" {
		t.Errorf("pages = %+v", pages)
	}
}

func TestDiagramMCP_MermaidReadsAsTextAndRefusesIncrementalWrites(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18143")
	path := filepath.Join(t.TempDir(), "sequence.mmd")
	if err := os.WriteFile(path, []byte("graph TD;\n  A-->B;\n"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	o, err := h.atlas.CreateBoardObject("diagram", map[string]string{"mirrorPath": path, "title": "Sequence"}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	if err := h.svc.store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("enable writes: %v", err)
	}

	var out atlasReadDiagramResult
	if err := json.Unmarshal([]byte(h.call(t, "atlas_read_diagram", map[string]any{"objectId": o.ID})), &out); err != nil {
		t.Fatalf("decode read: %v", err)
	}
	if out.Format != diagramFormatMermaid || !strings.Contains(out.Text, "A-->B") {
		t.Fatalf("mermaid read = %+v", out)
	}
	if len(out.Cells) != 0 {
		t.Errorf("mermaid reported cells: %+v", out.Cells)
	}

	assertToolError(t, h, "atlas_diagram_add_cells", map[string]any{
		"objectId": o.ID, "cells": []map[string]any{{"kind": "vertex"}},
	}, "Mermaid has no cell ids")
	assertToolError(t, h, "atlas_diagram_import", map[string]any{
		"objectId": o.ID, "content": "graph TD;\n  X-->Y;\n", "mode": "add",
	}, "Mermaid has no cell ids; use replace")
}

func TestDiagramMCP_WriteToolsRefuseWhenWritesAreDisabled(t *testing.T) {
	f := newDiagramMCPFixture(t, "127.0.0.1:18144")
	for name, args := range map[string]map[string]any{
		"atlas_diagram_add_cells":    {"objectId": f.objectID, "cells": []map[string]any{{"kind": "vertex"}}},
		"atlas_diagram_edit_cells":   {"objectId": f.objectID, "patches": []map[string]any{{"id": "a", "label": "x"}}},
		"atlas_diagram_delete_cells": {"objectId": f.objectID, "ids": []string{"a"}},
		"atlas_diagram_import":       {"objectId": f.objectID, "content": diagramMCPSource, "mode": "replace"},
		"atlas_create_board_object":  {"kind": "diagram", "content": diagramMCPSource},
	} {
		assertToolError(t, f.h, name, args, "MCP write tools are disabled")
	}
	if f.fileOnDisk(t) != diagramMCPSource {
		t.Error("a refused write still touched the file")
	}
}

func TestDiagramMCP_RefusesNonDiagramMirrorsAndUnknownIDs(t *testing.T) {
	f := newDiagramMCPFixture(t, "127.0.0.1:18145")
	f.enableUnattendedWrites(t)

	sheetPath := filepath.Join(t.TempDir(), "budget.xlsx")
	if err := os.WriteFile(sheetPath, []byte("binary-ish"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	sheet, err := f.h.atlas.CreateBoardObject("sheet", map[string]string{"mirrorPath": sheetPath}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	assertToolError(t, f.h, "atlas_read_diagram", map[string]any{"objectId": sheet.ID}, `is a "sheet", not a diagram`)
	assertToolError(t, f.h, "atlas_read_diagram", map[string]any{"objectId": "nope"}, "no board object with id")
	assertToolError(t, f.h, "atlas_diagram_edit_cells", map[string]any{
		"objectId": f.objectID, "patches": []map[string]any{{"id": "ghost", "label": "x"}},
	}, `no cell with id "ghost"`)
	assertToolError(t, f.h, "atlas_diagram_delete_cells", map[string]any{
		"objectId": f.objectID, "ids": []string{"1"},
	}, "cannot be deleted")
	assertToolError(t, f.h, "atlas_diagram_add_cells", map[string]any{
		"objectId": f.objectID, "cells": []map[string]any{{"id": "a", "kind": "vertex"}},
	}, `id "a" is already on this page`)
	assertToolError(t, f.h, "atlas_diagram_add_cells", map[string]any{
		"objectId": f.objectID, "cells": []map[string]any{{"kind": "edge", "source": "a", "target": "missing"}},
	}, `no cell with id "missing"`)
	if f.fileOnDisk(t) != diagramMCPSource {
		t.Error("a rejected write still touched the file")
	}
}

func TestDiagramMCP_CreateBoardObjectLandsADiagramWithItsOwnFile(t *testing.T) {
	f := newDiagramMCPFixture(t, "127.0.0.1:18146")
	f.enableUnattendedWrites(t)
	f.h.atlas.SetCapturesDir(t.TempDir())

	var created atlasBoardObjectSummary
	if err := json.Unmarshal([]byte(f.h.call(t, "atlas_create_board_object", map[string]any{
		"kind": "diagram", "payload": map[string]string{"title": "Agent sketch"},
		"content": diagramMCPSource, "position": map[string]any{"x": 12, "y": 34},
	})), &created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if created.Kind != "diagram" || created.Source.Type != "file" || created.Position.X != 12 {
		t.Fatalf("created = %+v", created)
	}
	if !strings.HasSuffix(created.Source.MirrorPath, ".drawio") {
		t.Errorf("mirrorPath = %q", created.Source.MirrorPath)
	}

	// The new object is immediately editable through the same tools.
	var out atlasReadDiagramResult
	if err := json.Unmarshal([]byte(f.h.call(t, "atlas_read_diagram", map[string]any{"objectId": created.ID})), &out); err != nil {
		t.Fatalf("decode read: %v", err)
	}
	if len(out.Cells) != 1 || out.Cells[0].Label != "Start" {
		t.Errorf("cells = %+v", out.Cells)
	}

	assertToolError(t, f.h, "atlas_create_board_object", map[string]any{"kind": "sticky"}, "is not a canvas object Mill knows")
	assertToolError(t, f.h, "atlas_create_board_object", map[string]any{"kind": "pdf"}, "needs a file")
	assertToolError(t, f.h, "atlas_create_board_object", map[string]any{"kind": "table"}, "pass payload.listID")
}

func assertToolError(t *testing.T, h *atlasMCPHarness, name string, args map[string]any, want string) {
	t.Helper()
	res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("%s: transport error: %v", name, err)
	}
	if !res.IsError {
		t.Fatalf("%s: expected an error naming %q, got success", name, want)
	}
	text := res.Content[0].(*mcp.TextContent).Text
	if !strings.Contains(text, want) {
		t.Errorf("%s: error = %q, want one naming %q", name, text, want)
	}
}

func TestDiagramMCP_ImportReplaceAndItsRefusals(t *testing.T) {
	f := newDiagramMCPFixture(t, "127.0.0.1:18147")
	f.enableUnattendedWrites(t)

	replacement := `<mxfile host="mill"><diagram id="r" name="Replaced"><mxGraphModel><root>` +
		`<mxCell id="0"/><mxCell id="1" parent="0"/>` +
		`<mxCell id="only" value="Whole new file" vertex="1" parent="1">` +
		`<mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`
	var out drawio.ImportResult
	if err := json.Unmarshal([]byte(f.h.call(t, "atlas_diagram_import", map[string]any{
		"objectId": f.objectID, "content": replacement, "mode": "replace",
	})), &out); err != nil {
		t.Fatalf("decode import replace: %v", err)
	}
	if out.Mode != "replace" {
		t.Fatalf("mode = %q", out.Mode)
	}
	after := f.read(t)
	if len(after.Pages) != 1 || after.Pages[0].Name != "Replaced" || len(after.Cells) != 1 {
		t.Errorf("after replace = %+v", after)
	}

	assertToolError(t, f.h, "atlas_diagram_import", map[string]any{
		"objectId": f.objectID, "content": replacement, "mode": "merge",
	}, "import mode must be")
	assertToolError(t, f.h, "atlas_diagram_import", map[string]any{
		"objectId": f.objectID, "content": "", "mode": "replace",
	}, "name the diagram content to import")
	assertToolError(t, f.h, "atlas_diagram_import", map[string]any{
		"objectId": f.objectID, "content": "just some prose", "mode": "replace",
	}, "not a draw.io diagram")
}

func TestDiagramMCP_ApprovalPromptsReadInThePersonsWords(t *testing.T) {
	f := newDiagramMCPFixture(t, "127.0.0.1:18148")
	f.enableUnattendedWrites(t)

	for _, tc := range []struct {
		name string
		in   atlasDiagramAddArgs
		want string
	}{
		{"one shape", atlasDiagramAddArgs{Cells: []drawio.CellSpec{{Kind: drawio.KindVertex}}}, "Add 1 shape to Architecture"},
		{"two shapes", atlasDiagramAddArgs{Cells: []drawio.CellSpec{{Kind: drawio.KindVertex}, {Kind: drawio.KindVertex}}}, "Add 2 shapes to Architecture"},
		{"connectors only", atlasDiagramAddArgs{Cells: []drawio.CellSpec{{Kind: drawio.KindEdge}, {Kind: drawio.KindEdge}}}, "Add 2 connectors to Architecture"},
		{"both", atlasDiagramAddArgs{Cells: []drawio.CellSpec{{Kind: drawio.KindVertex}, {Kind: drawio.KindEdge}}}, "Add 1 shape and 1 connector to Architecture"},
	} {
		if got := addCellsDescription(tc.in.Cells, "Architecture"); got != tc.want {
			t.Errorf("%s: %q, want %q", tc.name, got, tc.want)
		}
	}
	if got := pluralCells(1); got != "1 cell" {
		t.Errorf("pluralCells(1) = %q", got)
	}
	if got := pluralCells(4); got != "4 cells" {
		t.Errorf("pluralCells(4) = %q", got)
	}
	for _, tc := range []struct{ mode, pageName, want string }{
		{"replace", "", "Replace everything in D with an imported diagram"},
		{"add", "", "Merge an imported diagram into D"},
		{"new-page", "", "Add a page to D from an imported diagram"},
		{"new-page", "Appendix", `Add a page "Appendix" to D from an imported diagram`},
		{"nonsense", "", "Import a diagram into D"},
	} {
		if got := importDescription(tc.mode, "D", tc.pageName); got != tc.want {
			t.Errorf("importDescription(%q, %q) = %q, want %q", tc.mode, tc.pageName, got, tc.want)
		}
	}
}

func TestDiagramMCP_CreateBoardObjectOnACardAndItsTitleFallback(t *testing.T) {
	f := newDiagramMCPFixture(t, "127.0.0.1:18149")
	f.enableUnattendedWrites(t)
	f.h.atlas.SetCapturesDir(t.TempDir())

	kindID := f.h.kindIDByLabel(t, "Topic")
	parent, err := f.h.atlas.CreateCard(kindID, "Agent objects", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	var created atlasBoardObjectSummary
	if err := json.Unmarshal([]byte(f.h.call(t, "atlas_create_board_object", map[string]any{
		"kind": "sheet", "content": "Item,Qty\nBeans,2\n", "parentId": parent.ID,
	})), &created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if created.ParentID != parent.ID || !strings.HasSuffix(created.Source.MirrorPath, ".csv") {
		t.Fatalf("created = %+v", created)
	}
	// No title given: the kind plus the moment, never an empty name.
	o, err := f.h.svc.findBoardObject(created.ID)
	if err != nil {
		t.Fatalf("findBoardObject: %v", err)
	}
	if !strings.HasPrefix(o.Payload["title"], "sheet-") {
		t.Errorf("title = %q", o.Payload["title"])
	}
	// Position defaults to the board's own near-origin point.
	if created.Position.X != defaultBoardObjectPosition.X || created.Position.Y != defaultBoardObjectPosition.Y {
		t.Errorf("position = %+v", created.Position)
	}

	assertToolError(t, f.h, "atlas_create_board_object", map[string]any{
		"kind": "diagram", "content": diagramMCPSource, "parentId": "no-such-card",
	}, `no card with id "no-such-card"`)
	assertToolError(t, f.h, "atlas_create_board_object", map[string]any{
		"kind": "shape", "content": "whatever",
	}, "content is accepted for: diagram, sheet")
}

// clearLabel is how an agent removes a cell's text: an empty label
// still means unchanged, so erasing needs its own flag.
func TestDiagramMCP_ClearLabelErasesACellsText(t *testing.T) {
	f := newDiagramMCPFixture(t, "127.0.0.1:18168")
	f.enableUnattendedWrites(t)

	f.h.call(t, "atlas_diagram_edit_cells", map[string]any{
		"objectId": f.objectID,
		"patches":  []map[string]any{{"id": "a", "label": ""}},
	})
	if label := f.labelOf(t, "a"); label != "Start" {
		t.Fatalf("an empty label changed the cell's text to %q, want Start left alone", label)
	}

	f.h.call(t, "atlas_diagram_edit_cells", map[string]any{
		"objectId": f.objectID,
		"patches":  []map[string]any{{"id": "a", "clearLabel": true}},
	})
	if label := f.labelOf(t, "a"); label != "" {
		t.Fatalf("clearLabel left the text %q behind", label)
	}
}

func (f *diagramMCPFixture) labelOf(t *testing.T, cellID string) string {
	t.Helper()
	for _, c := range f.read(t).Cells {
		if c.ID == cellID {
			return c.Label
		}
	}
	t.Fatalf("no cell %q in the diagram", cellID)
	return ""
}
