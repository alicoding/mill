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
