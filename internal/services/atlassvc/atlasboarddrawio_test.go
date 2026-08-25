package atlassvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// testKindID picks any real, already-seeded Kind id -- CreateCard
// requires one, and every fresh AtlasService (newTestAtlasService) has
// reconcileBuiltIns's own seeded kinds present.
func testKindID(t *testing.T, a *AtlasService) string {
	t.Helper()
	kinds := a.Kinds()
	if len(kinds) == 0 {
		t.Fatal("expected at least one seeded kind")
	}
	return kinds[0].ID
}

// The acceptance test that matters (docs/goals/0194's own export
// slice): a board built through the SAME import fixtures atlaspaste_test.go
// already proves, exported and re-imported into a fresh instance, must
// land the same cards/links/containment. Scoped under a fresh container
// card so the count assertions aren't diluted by the seeded example
// space every newTestAtlasService starts with.
func TestExportBoardAsDrawio_RoundTripsContainmentAndSplitNote(t *testing.T) {
	a := newTestAtlasService(t)
	root, err := a.CreateCard(testKindID(t, a), "Export Root", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.PasteToBoard(pasteContainerXML, root.ID, 0, 0); err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}

	export, err := a.ExportBoardAsDrawio(root.ID)
	if err != nil {
		t.Fatalf("ExportBoardAsDrawio: %v", err)
	}
	if export.Cards != 3 || export.Links != 0 {
		t.Fatalf("export = %+v, want 3 cards no links", export)
	}
	if len(export.Skipped) != 0 {
		t.Fatalf("Skipped = %v, want none", export.Skipped)
	}

	b := newTestAtlasService(t)
	res, err := b.PasteToBoard(export.XML, "", 0, 0)
	if err != nil {
		t.Fatalf("re-import PasteToBoard: %v", err)
	}
	if !res.Recognized || res.Cards != 3 {
		t.Fatalf("re-import result = %+v, want 3 recognized cards", res)
	}

	byTitle := make(map[string]atlas.Card)
	for _, c := range b.Cards() {
		byTitle[c.Title] = c
	}
	lane, v1, v2 := byTitle["Runtime Path"], byTitle["Vendor API"], byTitle["Free node"]
	if lane.ID == "" || v1.ID == "" || v2.ID == "" {
		t.Fatalf("expected all three cards to survive the round trip, got lane=%+v v1=%+v v2=%+v", lane, v1, v2)
	}
	if v1.ParentID != lane.ID {
		t.Errorf("Vendor API ParentID = %q, want the re-imported container %q", v1.ParentID, lane.ID)
	}
	if v2.ParentID != "" {
		t.Errorf("Free node ParentID = %q, want root-level", v2.ParentID)
	}
	// The multi-line note round-trips through Value = title + "\n" + note
	// (cardVertexCell's own inverse of splitVertexText).
	if v1.Note != "Handles auth\nOwner: SRE" {
		t.Errorf("Vendor API note = %q, want the detail lines preserved", v1.Note)
	}
}

// Containment isn't hardcoded to one level on export either -- same
// three-deep fixture atlaspaste_test.go already proves on import.
func TestExportBoardAsDrawio_RoundTripsDeepNesting(t *testing.T) {
	a := newTestAtlasService(t)
	root, err := a.CreateCard(testKindID(t, a), "Export Root", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.PasteToBoard(pasteDeepNestXML, root.ID, 0, 0); err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	export, err := a.ExportBoardAsDrawio(root.ID)
	if err != nil {
		t.Fatalf("ExportBoardAsDrawio: %v", err)
	}

	b := newTestAtlasService(t)
	res, err := b.PasteToBoard(export.XML, "", 0, 0)
	if err != nil {
		t.Fatalf("re-import PasteToBoard: %v", err)
	}
	if !res.Recognized || res.Cards != 3 {
		t.Fatalf("re-import result = %+v, want 3 recognized cards", res)
	}
	byTitle := make(map[string]atlas.Card)
	for _, c := range b.Cards() {
		byTitle[c.Title] = c
	}
	outer, inner, leaf := byTitle["Outer"], byTitle["Inner"], byTitle["Leaf"]
	if inner.ParentID != outer.ID {
		t.Errorf("Inner ParentID = %q, want Outer %q", inner.ParentID, outer.ID)
	}
	if leaf.ParentID != inner.ID {
		t.Errorf("Leaf ParentID = %q, want Inner %q", leaf.ParentID, inner.ID)
	}
}

// Links round-trip too: an edge's source/target must resolve back onto
// the SAME two re-imported cards, and the label survives as the edge's
// own Value.
func TestExportBoardAsDrawio_RoundTripsLinks(t *testing.T) {
	a := newTestAtlasService(t)
	root, err := a.CreateCard(testKindID(t, a), "Export Root", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.PasteToBoard(pasteDiagramXML, root.ID, 0, 0); err != nil {
		t.Fatalf("PasteToBoard: %v", err)
	}
	export, err := a.ExportBoardAsDrawio(root.ID)
	if err != nil {
		t.Fatalf("ExportBoardAsDrawio: %v", err)
	}
	if export.Cards != 2 || export.Links != 1 {
		t.Fatalf("export = %+v, want 2 cards 1 link", export)
	}

	b := newTestAtlasService(t)
	res, err := b.PasteToBoard(export.XML, "", 0, 0)
	if err != nil {
		t.Fatalf("re-import: %v", err)
	}
	if res.Cards != 2 || res.Links != 1 {
		t.Fatalf("re-import result = %+v, want 2 cards 1 link", res)
	}
	found := false
	for _, l := range b.Links() {
		if l.Label == "calls" {
			found = true
		}
	}
	if !found {
		t.Error("expected the re-imported link to keep its \"calls\" label")
	}
}

// boardSubtree is the export's own scoping: exporting one card's board
// must never pull in a sibling subtree, even though both live in the
// same overall graph.
func TestBoardSubtree_ScopesToRequestedSpaceOnly(t *testing.T) {
	a := newTestAtlasService(t)
	spaceA, err := a.CreateCard(testKindID(t, a), "Space A", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	spaceB, err := a.CreateCard(testKindID(t, a), "Space B", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.CreateCard(testKindID(t, a), "In A", "", nil, spaceA.ID, nil, "", "", "", ""); err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.CreateCard(testKindID(t, a), "In B", "", nil, spaceB.ID, nil, "", "", "", ""); err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	export, err := a.ExportBoardAsDrawio(spaceA.ID)
	if err != nil {
		t.Fatalf("ExportBoardAsDrawio: %v", err)
	}
	if export.Cards != 1 {
		t.Fatalf("export = %+v, want exactly the one card under Space A", export)
	}
	if !strings.Contains(export.XML, "In A") || strings.Contains(export.XML, "In B") {
		t.Errorf("XML must contain %q and never %q, got:\n%s", "In A", "In B", export.XML)
	}
}

// rectangle/ellipse shapes export as styled vertex cells; a freeform
// arrow has no faithful cell mapping and must be named skipped, not
// silently dropped.
func TestExportBoardAsDrawio_ShapesStyledArrowSkipped(t *testing.T) {
	a := newTestAtlasService(t)
	root, err := a.CreateCard(testKindID(t, a), "Export Root", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	rectPayload := map[string]string{"shapeType": "rectangle", "fill": "#238636", "stroke": "#1f6feb", "strokeWidth": "2", "title": "Status"}
	if _, err := a.CreateBoardObject("shape", rectPayload, atlas.Position{X: 10, Y: 20}, root.ID); err != nil {
		t.Fatalf("CreateBoardObject rectangle: %v", err)
	}
	arrowPayload := map[string]string{"shapeType": "arrow", "stroke": "#da3633", "strokeWidth": "1", "title": "", "dx": "40", "dy": "0"}
	if _, err := a.CreateBoardObject("shape", arrowPayload, atlas.Position{X: 0, Y: 0}, root.ID); err != nil {
		t.Fatalf("CreateBoardObject arrow: %v", err)
	}

	export, err := a.ExportBoardAsDrawio(root.ID)
	if err != nil {
		t.Fatalf("ExportBoardAsDrawio: %v", err)
	}
	if export.Shapes != 1 {
		t.Fatalf("Shapes = %d, want exactly the one rectangle", export.Shapes)
	}
	if len(export.Skipped) != 1 || !strings.Contains(export.Skipped[0], "freeform arrow") {
		t.Fatalf("Skipped = %v, want the arrow named", export.Skipped)
	}
	if !strings.Contains(export.XML, "fillColor=#238636") || !strings.Contains(export.XML, "strokeColor=#1f6feb") {
		t.Errorf("expected the rectangle's own fill/stroke in the style string, got:\n%s", export.XML)
	}
}

// An ink or image board object is out of scope for v1 -- named
// skipped, never rendered as a plain vertex that would look like real
// content.
func TestExportBoardAsDrawio_InkAndImageAreSkippedByName(t *testing.T) {
	a := newTestAtlasService(t)
	root, err := a.CreateCard(testKindID(t, a), "Export Root", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	if _, err := a.CreateBoardObject("ink", map[string]string{"title": "Sketch"}, atlas.Position{}, root.ID); err != nil {
		t.Fatalf("CreateBoardObject ink: %v", err)
	}
	if _, err := a.CreateBoardObject("image", map[string]string{"title": "Screenshot", "mirrorPath": "/tmp/does-not-exist.png"}, atlas.Position{}, root.ID); err != nil {
		t.Fatalf("CreateBoardObject image: %v", err)
	}

	export, err := a.ExportBoardAsDrawio(root.ID)
	if err != nil {
		t.Fatalf("ExportBoardAsDrawio: %v", err)
	}
	if len(export.Skipped) != 2 {
		t.Fatalf("Skipped = %v, want ink and image both named", export.Skipped)
	}
	joined := strings.Join(export.Skipped, " | ")
	if !strings.Contains(joined, "Sketch") || !strings.Contains(joined, "Screenshot") {
		t.Errorf("Skipped = %v, want both titles named", export.Skipped)
	}
}
