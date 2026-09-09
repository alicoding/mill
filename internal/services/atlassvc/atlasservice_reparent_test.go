package atlassvc

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// mustKind/mustCard/mustBoardObject/findObject collapse this file's
// repeated create-or-fail and find-by-id shapes into one branch each
// (gocognit @ 15, testing.md's quality gate) -- every test below reads
// as its own scenario's setup + assertions, not create/check-err
// boilerplate.

func mustKind(t *testing.T, a *AtlasService) atlas.Kind {
	t.Helper()
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	return k
}

func mustCard(t *testing.T, a *AtlasService, kindID, title, parentID string, pos *atlas.Position) atlas.Card {
	t.Helper()
	c, err := a.CreateCard(kindID, title, "", nil, parentID, pos, atlas.ViewMode(""), "", "", "")
	if err != nil {
		t.Fatalf("CreateCard(%s): %v", title, err)
	}
	return c
}

func mustBoardObject(t *testing.T, a *AtlasService, pos atlas.Position, parentID string) atlas.BoardObject {
	t.Helper()
	o, err := a.CreateBoardObject("shape", nil, pos, parentID)
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	return o
}

func findObject(a *AtlasService, id string) *atlas.BoardObject {
	for _, o := range a.Objects() {
		if o.ID == id {
			return &o
		}
	}
	return nil
}

// TestDeleteCard_ReparentedBoardObjectLandsClearOfExistingContent pins
// goal 0233's core contract: a board object re-parented by its parent
// card's delete gets a fresh position clear of whatever else already
// occupies the new parent, not its raw pre-re-parent X/Y.
func TestDeleteCard_ReparentedBoardObjectLandsClearOfExistingContent(t *testing.T) {
	a := newTestAtlasService(t)
	k := mustKind(t, a)
	mustCard(t, a, k.ID, "Sibling", "", &atlas.Position{X: 0, Y: 0})
	container := mustCard(t, a, k.ID, "Container", "", nil)
	obj := mustBoardObject(t, a, atlas.Position{X: 500, Y: 500}, container.ID)

	if _, err := a.DeleteCard(container.ID); err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}

	reparented := findObject(a, obj.ID)
	if reparented == nil {
		t.Fatal("re-parented board object missing from Objects() after its parent card was deleted")
	}
	if reparented.ParentID != "" {
		t.Errorf("reparented.ParentID = %q, want root (EffectiveParentID past the deleted card)", reparented.ParentID)
	}
	if reparented.Position == (atlas.Position{X: 500, Y: 500}) {
		t.Error("re-parented object kept its stale pre-re-parent position instead of a fresh one")
	}
	// Clear of Sibling's own box (X:0,Y:0, the default leaf-card
	// footprint reparentLeafHeight tall) -- the exact overlap goal
	// 0233 exists to close.
	if reparented.Position.Y < reparentLeafHeight {
		t.Errorf("reparented.Position.Y = %v, want >= %v (clear of Sibling's own footprint)", reparented.Position.Y, reparentLeafHeight)
	}

	// Undo restores the ORIGINAL pre-re-parent position, not the
	// re-parented one -- the repositioning rides the delete's own undo
	// entry rather than a separate journal record.
	if result := a.Undo(); !result.Applied {
		t.Fatalf("Undo() = %+v, want Applied", result)
	}
	restored := findObject(a, obj.ID)
	if restored == nil {
		t.Fatal("board object missing from Objects() after undoing the delete")
	}
	if restored.Position != (atlas.Position{X: 500, Y: 500}) {
		t.Errorf("restored.Position = %+v, want the original {500 500}", restored.Position)
	}
	if restored.ParentID != container.ID {
		t.Errorf("restored.ParentID = %q, want %q (undo also restored Container itself)", restored.ParentID, container.ID)
	}
}

// TestDeleteCard_ReparentedObjectClearsAnAlreadyReparentedSibling pins a
// distinct trap in the same mechanism: a sibling that is ITSELF a
// virtually-re-parented child of a DIFFERENT tombstoned ancestor still
// carries that ancestor's raw id in its own ParentID field
// (liveCardsLocked's read-time-only contract) -- a naive raw-equality
// scan for "what already occupies newParentID" misses it entirely.
func TestDeleteCard_ReparentedObjectClearsAnAlreadyReparentedSibling(t *testing.T) {
	a := newTestAtlasService(t)
	k := mustKind(t, a)
	grandparent := mustCard(t, a, k.ID, "Grandparent", "", nil)
	sibling := mustCard(t, a, k.ID, "Sibling", grandparent.ID, &atlas.Position{X: 80, Y: 80})
	if _, err := a.DeleteCard(grandparent.ID); err != nil {
		t.Fatalf("DeleteCard(Grandparent): %v", err)
	}
	// Sibling is now root-effective, but its OWN stored ParentID still
	// names the tombstoned Grandparent -- exactly the state that missed
	// the sibling before this fix.
	container := mustCard(t, a, k.ID, "Container", "", nil)
	obj := mustBoardObject(t, a, atlas.Position{X: 500, Y: 500}, container.ID)

	if _, err := a.DeleteCard(container.ID); err != nil {
		t.Fatalf("DeleteCard(Container): %v", err)
	}

	reparented := findObject(a, obj.ID)
	if reparented == nil {
		t.Fatal("re-parented board object missing from Objects()")
	}
	if reparented.Position.Y < sibling.Position.Y+reparentLeafHeight {
		t.Errorf("reparented.Position.Y = %v, want >= %v (clear of Sibling's own already-re-parented footprint)", reparented.Position.Y, sibling.Position.Y+reparentLeafHeight)
	}
}

// TestRepositionReparentedObjectsLocked_ClearsMultipleReparentedSiblings
// pins the row-layout half directly: two objects re-parented by the SAME
// delete must not land on top of each other either.
func TestRepositionReparentedObjectsLocked_ClearsMultipleReparentedSiblings(t *testing.T) {
	a := newTestAtlasService(t)
	k := mustKind(t, a)
	container := mustCard(t, a, k.ID, "Container", "", nil)
	o1 := mustBoardObject(t, a, atlas.Position{X: 10, Y: 10}, container.ID)
	o2 := mustBoardObject(t, a, atlas.Position{X: 20, Y: 20}, container.ID)

	if _, err := a.DeleteCard(container.ID); err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}

	p1, p2 := findObject(a, o1.ID), findObject(a, o2.ID)
	if p1 == nil || p2 == nil {
		t.Fatal("a re-parented object is missing from Objects()")
	}
	if p1.Position == p2.Position {
		t.Errorf("both re-parented objects landed at the same position %+v", p1.Position)
	}
}

// TestRepositionReparentedObjectsLocked_TableShapedKindGetsItsRealFootprint
// pins the estimate itself, not just that two positions differ: an
// unsized 'sheet'/'json' object renders wider than the generic
// reparentObjectFootprintW clamp (its own content face's own
// frameStyle default), so the row layout must space the NEXT re-parented
// object clear of that real width -- under-estimating it left the
// following object's row slot landing inside the wide one's own
// rendered box.
func TestRepositionReparentedObjectsLocked_TableShapedKindGetsItsRealFootprint(t *testing.T) {
	a := newTestAtlasService(t)
	k := mustKind(t, a)
	container := mustCard(t, a, k.ID, "Container", "", nil)
	wide, err := a.CreateBoardObject("sheet", nil, atlas.Position{X: 10, Y: 10}, container.ID)
	if err != nil {
		t.Fatalf("CreateBoardObject(sheet): %v", err)
	}
	next := mustBoardObject(t, a, atlas.Position{X: 20, Y: 20}, container.ID)

	if _, err := a.DeleteCard(container.ID); err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}

	pWide, pNext := findObject(a, wide.ID), findObject(a, next.ID)
	if pWide == nil || pNext == nil {
		t.Fatal("a re-parented object is missing from Objects()")
	}
	if pNext.Position.X < pWide.Position.X+reparentTableFootprintW+reparentGap {
		t.Errorf("pNext.Position.X = %v, want >= %v (clear of the unsized sheet's own real table-shaped width)",
			pNext.Position.X, pWide.Position.X+reparentTableFootprintW+reparentGap)
	}
}

// TestReparentObjectFootprint_MatchesFrontendFallbackExtent pins the
// generic footprint across the two languages that both encode it:
// atlasBoardLayout.ts's OBJECT_FALLBACK_EXTENT is the frontend's own
// name for AtlasBoardObjectNode.module.css's 480px-per-axis clamp on
// unsized content, and reparentObjectFootprintW/H is this package's
// estimate of that same rendered box. They are two hand-maintained
// copies of one number with no shared source, so a change on either
// side alone silently reintroduces the overlap the re-parent row
// layout exists to avoid -- this test reads the TypeScript constant
// directly and fails the build when the pair diverges.
func TestReparentObjectFootprint_MatchesFrontendFallbackExtent(t *testing.T) {
	const rel = "../../../frontend/src/atlas/atlasBoardLayout.ts"
	src, err := os.ReadFile(filepath.Clean(rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	m := regexp.MustCompile(`OBJECT_FALLBACK_EXTENT\s*=\s*(\d+)`).FindSubmatch(src)
	if m == nil {
		t.Fatalf("no `OBJECT_FALLBACK_EXTENT = <n>` declaration in %s -- if it was renamed, rename it here too", rel)
	}
	extent, err := strconv.Atoi(string(m[1]))
	if err != nil {
		t.Fatalf("OBJECT_FALLBACK_EXTENT is not an integer: %v", err)
	}
	w, h := reparentObjectFootprint("ink")
	if w != float64(extent) || h != float64(extent) {
		t.Errorf("reparentObjectFootprint(unsized kind) = (%v, %v), want (%d, %d) to match OBJECT_FALLBACK_EXTENT",
			w, h, extent, extent)
	}
}
