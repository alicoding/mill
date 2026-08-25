package atlassvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// A "diagram" board object (goal 0179 S2's dropped-file door) whose
// mirrored file parses embeds as its OWN page, named after the object's
// title -- not flattened into the board's own page.
func TestExportBoardAsDrawio_DiagramObjectEmbedsAsOwnPage(t *testing.T) {
	a := newTestAtlasService(t)
	root, err := a.CreateCard(testKindID(t, a), "Export Root", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	mirrorXML := `<mxfile><diagram name="Original Page"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
		`<mxCell id="v" value="Mirrored" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40"/></mxCell>` +
		`</root></mxGraphModel></diagram></mxfile>`
	path := filepath.Join(t.TempDir(), "flow.drawio")
	if err := os.WriteFile(path, []byte(mirrorXML), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := a.CreateBoardObject("diagram", map[string]string{"mirrorPath": path, "title": "Runtime Flow"}, atlas.Position{}, root.ID); err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	export, err := a.ExportBoardAsDrawio(root.ID)
	if err != nil {
		t.Fatalf("ExportBoardAsDrawio: %v", err)
	}
	if export.Pages != 2 {
		t.Fatalf("Pages = %d, want 2 (the board itself + the embedded mirror)", export.Pages)
	}
	if len(export.Skipped) != 0 {
		t.Fatalf("Skipped = %v, want none -- the mirror parses", export.Skipped)
	}
	if !strings.Contains(export.XML, "Runtime Flow") || !strings.Contains(export.XML, "Mirrored") {
		t.Errorf("expected the embedded page's own name and cell value in the output, got:\n%s", export.XML)
	}
}

// A vanished mirror file is named skipped, never a silent drop.
func TestExportBoardAsDrawio_DiagramObjectMissingFileIsSkipped(t *testing.T) {
	a := newTestAtlasService(t)
	root, err := a.CreateCard(testKindID(t, a), "Export Root", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.CreateBoardObject("diagram", map[string]string{"mirrorPath": "/tmp/gone-does-not-exist.drawio", "title": "Gone"}, atlas.Position{}, root.ID); err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	export, err := a.ExportBoardAsDrawio(root.ID)
	if err != nil {
		t.Fatalf("ExportBoardAsDrawio: %v", err)
	}
	if export.Pages != 1 {
		t.Fatalf("Pages = %d, want just the board's own page", export.Pages)
	}
	if len(export.Skipped) != 1 || !strings.Contains(export.Skipped[0], "Gone") || !strings.Contains(export.Skipped[0], "file not found") {
		t.Fatalf("Skipped = %v, want \"Gone (file not found)\"", export.Skipped)
	}
}

// A non-draw.io mirror (a .mmd/.mermaid source) is named skipped too --
// this export slice never guesses at a format it can't parse.
func TestExportBoardAsDrawio_NonDrawioMirrorIsSkipped(t *testing.T) {
	a := newTestAtlasService(t)
	root, err := a.CreateCard(testKindID(t, a), "Export Root", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	path := filepath.Join(t.TempDir(), "flow.mmd")
	if err := os.WriteFile(path, []byte("graph TD\nA-->B"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := a.CreateBoardObject("diagram", map[string]string{"mirrorPath": path, "title": "Flow"}, atlas.Position{}, root.ID); err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	export, err := a.ExportBoardAsDrawio(root.ID)
	if err != nil {
		t.Fatalf("ExportBoardAsDrawio: %v", err)
	}
	if len(export.Skipped) != 1 || !strings.Contains(export.Skipped[0], "Flow") {
		t.Fatalf("Skipped = %v, want the mermaid mirror named", export.Skipped)
	}
}
