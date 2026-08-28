package mcpsvc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Board-object visibility over MCP (goal 0179 close-out, ADR-0046):
// seeds one board object of each of the three content-plane source
// kinds (file/list/board-local) under a fresh root card, then proves
// both the summary tool and the full-content tool against the exact
// per-kind shape their own descriptions promise.

func seedBoardObjectFixtures(t *testing.T, h *atlasMCPHarness) (rootID string, imageID, diagramID, tableID, shapeID string) {
	t.Helper()
	kindID := h.kindIDByLabel(t, "Topic")
	root, err := h.atlas.CreateCard(kindID, "Board object fixtures", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	dir := t.TempDir()
	pngPath := filepath.Join(dir, "reference.png")
	if err := os.WriteFile(pngPath, []byte("not a real png but bytes are enough"), 0o600); err != nil {
		t.Fatalf("write png fixture: %v", err)
	}
	drawioPath := filepath.Join(dir, "flow.drawio")
	if err := os.WriteFile(drawioPath, []byte("<mxfile><diagram>flow</diagram></mxfile>"), 0o600); err != nil {
		t.Fatalf("write drawio fixture: %v", err)
	}

	h.atlas.WireListProjection(func(listID string) (atlassvc.ListProjection, bool) {
		if listID != "list-vendors" {
			return atlassvc.ListProjection{}, false
		}
		return atlassvc.ListProjection{
			ListID: "list-vendors", Label: "Vendor tracker",
			Columns: []atlassvc.ProjectionColumn{{Key: "vendor", Label: "Vendor", Type: "text"}},
			Rows:    []atlassvc.ProjectionRow{{ID: "row-1", Status: "active", Values: map[string]string{"vendor": "Acme"}}},
		}, true
	})

	image, err := h.atlas.CreateBoardObject("image", map[string]string{"mirrorPath": pngPath, "title": "Reference image"}, atlas.Position{X: 1, Y: 2}, root.ID)
	if err != nil {
		t.Fatalf("CreateBoardObject image: %v", err)
	}
	diagram, err := h.atlas.CreateBoardObject("diagram", map[string]string{"mirrorPath": drawioPath}, atlas.Position{}, root.ID)
	if err != nil {
		t.Fatalf("CreateBoardObject diagram: %v", err)
	}
	table, err := h.atlas.CreateBoardObject("table", map[string]string{"listID": "list-vendors"}, atlas.Position{}, root.ID)
	if err != nil {
		t.Fatalf("CreateBoardObject table: %v", err)
	}
	shape, err := h.atlas.CreateBoardObject("shape", map[string]string{"shapeType": "rectangle", "fill": "#238636", "stroke": "#1f6feb"}, atlas.Position{}, root.ID)
	if err != nil {
		t.Fatalf("CreateBoardObject shape: %v", err)
	}
	return root.ID, image.ID, diagram.ID, table.ID, shape.ID
}

func TestAtlasMCP_ReadBoardObjects_SummarizesEveryKindByParent(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18110")
	rootID, imageID, diagramID, tableID, shapeID := seedBoardObjectFixtures(t, h)

	text := h.call(t, "atlas_read_board_objects", map[string]any{"parentId": rootID})
	var out atlasReadBoardObjectsResult
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_read_board_objects result is not the typed JSON: %v", err)
	}
	if len(out.Objects) != 4 {
		t.Fatalf("Objects = %+v, want exactly the 4 fixtures scoped to parentId", out.Objects)
	}

	byID := map[string]atlasBoardObjectSummary{}
	for _, o := range out.Objects {
		byID[o.ID] = o
	}

	image, ok := byID[imageID]
	if !ok {
		t.Fatalf("image object %q missing from summary: %+v", imageID, out.Objects)
	}
	if image.Kind != "image" || image.ParentID != rootID {
		t.Errorf("image summary = %+v, want kind=image parentId=%q", image, rootID)
	}
	if image.Source.Type != "file" || image.Source.MimeType != "image/png" || image.Source.MirrorPath == "" {
		t.Errorf("image source = %+v, want file-backed png with a mirrorPath", image.Source)
	}
	if image.Position.X != 1 || image.Position.Y != 2 {
		t.Errorf("image position = %+v, want {1 2}", image.Position)
	}

	diagram, ok := byID[diagramID]
	if !ok || diagram.Source.Type != "file" || diagram.Source.MimeType != "" {
		t.Errorf("diagram summary = %+v, want file-backed with no MIME type (a text format)", diagram)
	}

	table, ok := byID[tableID]
	if !ok || table.Source.Type != "list" || table.Source.ListID != "list-vendors" || table.Source.ListLabel != "Vendor tracker" {
		t.Errorf("table summary = %+v, want list-backed with the wired List's id and label", table)
	}

	shape, ok := byID[shapeID]
	if !ok || shape.Source.Type != "board-local" {
		t.Fatalf("shape summary = %+v, want board-local", shape)
	}
	if shape.Source.Summary != "rectangle shape" {
		t.Errorf("shape summary payload text = %q, want the shapeType-first summary", shape.Source.Summary)
	}
}

func TestAtlasMCP_ReadBoardObjects_NoParentListsEveryObjectAcrossTheBoard(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18111")
	_, imageID, _, _, _ := seedBoardObjectFixtures(t, h)

	// Unscoped: also includes the seeded built-in board-object examples
	// (boardobject_builtin.go) parented elsewhere -- this asserts the
	// fixture is a SUBSET, never an exact count, so it stays honest
	// about builtins without depending on their own count.
	text := h.call(t, "atlas_read_board_objects", nil)
	var out atlasReadBoardObjectsResult
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_read_board_objects result is not the typed JSON: %v", err)
	}
	var sawImage bool
	for _, o := range out.Objects {
		if o.ID == imageID {
			sawImage = true
		}
	}
	if !sawImage {
		t.Errorf("unscoped atlas_read_board_objects missing the fixture image %q: %+v", imageID, out.Objects)
	}
}

func TestAtlasMCP_ReadBoardObject_FileBackedImage_WithholdsBytesReportsMime(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18112")
	_, imageID, _, _, _ := seedBoardObjectFixtures(t, h)

	text := h.call(t, "atlas_read_board_object", map[string]any{"objectId": imageID})
	var out atlasBoardObjectContentOut
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_read_board_object result is not the typed JSON: %v", err)
	}
	if out.Source != "file" || out.MimeType != "image/png" || out.MirrorPath == "" {
		t.Errorf("image content = %+v, want file source with image/png mime and a path", out)
	}
	if out.Content != "" {
		t.Errorf("image content.Content = %q, want empty -- bytes must never ride the wire", out.Content)
	}
	if out.FileSize == 0 || out.Missing || out.TooLarge {
		t.Errorf("image content = %+v, want a nonzero size, present and not too large", out)
	}
}

func TestAtlasMCP_ReadBoardObject_FileBackedDiagram_ReturnsTextContentInline(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18113")
	_, _, diagramID, _, _ := seedBoardObjectFixtures(t, h)

	text := h.call(t, "atlas_read_board_object", map[string]any{"objectId": diagramID})
	var out atlasBoardObjectContentOut
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_read_board_object result is not the typed JSON: %v", err)
	}
	if out.Source != "file" || out.Content != "<mxfile><diagram>flow</diagram></mxfile>" {
		t.Errorf("diagram content = %+v, want the drawio XML inline as text", out)
	}
	if out.MimeType != "" {
		t.Errorf("diagram content.MimeType = %q, want empty for a text format", out.MimeType)
	}
}

func TestAtlasMCP_ReadBoardObject_ListBacked_ReturnsProjectedColumnsAndRows(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18114")
	_, _, _, tableID, _ := seedBoardObjectFixtures(t, h)

	text := h.call(t, "atlas_read_board_object", map[string]any{"objectId": tableID})
	var out atlasBoardObjectContentOut
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_read_board_object result is not the typed JSON: %v", err)
	}
	if out.Source != "list" || out.ListID != "list-vendors" || out.ListLabel != "Vendor tracker" {
		t.Errorf("table content = %+v, want the projected List's id and label", out)
	}
	if len(out.Columns) != 1 || out.Columns[0].Key != "vendor" || out.Columns[0].Label != "Vendor" {
		t.Errorf("table columns = %+v, want the one wired vendor column", out.Columns)
	}
	if len(out.Rows) != 1 || out.Rows[0].ID != "row-1" || out.Rows[0].Values["vendor"] != "Acme" {
		t.Errorf("table rows = %+v, want the one wired Acme row", out.Rows)
	}
}

func TestAtlasMCP_ReadBoardObject_BoardLocalShape_ReturnsFullPayload(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18115")
	_, _, _, _, shapeID := seedBoardObjectFixtures(t, h)

	text := h.call(t, "atlas_read_board_object", map[string]any{"objectId": shapeID})
	var out atlasBoardObjectContentOut
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("atlas_read_board_object result is not the typed JSON: %v", err)
	}
	if out.Source != "board-local" {
		t.Fatalf("shape content.Source = %q, want board-local", out.Source)
	}
	if out.Payload["shapeType"] != "rectangle" || out.Payload["fill"] != "#238636" || out.Payload["stroke"] != "#1f6feb" {
		t.Errorf("shape payload = %+v, want the full stored payload", out.Payload)
	}
}

func TestSummarizeBoardLocalPayload_PrecedenceAndFallback(t *testing.T) {
	cases := []struct {
		name    string
		payload map[string]string
		want    string
	}{
		{"text wins over everything", map[string]string{"text": "a quick jot", "shapeType": "rectangle"}, "a quick jot"},
		{"shapeType wins over the generic fallback", map[string]string{"shapeType": "ellipse", "fill": "#fff"}, "ellipse shape"},
		{"neither present falls back to a sorted key=value join", map[string]string{"dx": "40", "dy": "0"}, "dx=40, dy=0"},
		{"empty values are skipped in the fallback join", map[string]string{"stroke": "", "fill": "#000"}, "fill=#000"},
		{"nil payload summarizes empty", nil, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := summarizeBoardLocalPayload(tc.payload); got != tc.want {
				t.Errorf("summarizeBoardLocalPayload(%+v) = %q, want %q", tc.payload, got, tc.want)
			}
		})
	}
}

func TestAtlasMCP_ReadBoardObject_UnknownID_Errors(t *testing.T) {
	h := newAtlasMCPHarness(t, "127.0.0.1:18116")
	res, err := h.session.CallTool(h.ctx, &mcp.CallToolParams{Name: "atlas_read_board_object", Arguments: map[string]any{"objectId": "does-not-exist"}})
	if err != nil {
		t.Fatalf("transport error: %v", err)
	}
	if !res.IsError {
		t.Error("atlas_read_board_object on an unknown id must return an error result")
	}
}
