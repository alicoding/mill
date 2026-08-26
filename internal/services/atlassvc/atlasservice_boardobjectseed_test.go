package atlassvc

import (
	"os"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// findObjectByKind is this file's own lookup: BoardObject IDs are
// package-private atlas constants, so tests here key off Kind the same
// way a real caller (a frontend renderer) would.
func findObjectByKind(t *testing.T, objects []atlas.BoardObject, kind string) atlas.BoardObject {
	t.Helper()
	for _, o := range objects {
		if o.Kind == kind {
			return o
		}
	}
	t.Fatalf("no seeded board object of kind %q found", kind)
	return atlas.BoardObject{}
}

// TestReconcileBuiltIns_SeedsShapeOnFreshInstall proves the shape
// golden (goal 0223, 0214's own retroactive seed proof) lands on a
// fresh install with no captures directory wired at all -- unlike
// ink/image, a shape carries no mirror file, so it needs nothing
// beyond construction to seed.
func TestReconcileBuiltIns_SeedsShapeOnFreshInstall(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())
	shape := findObjectByKind(t, a.Objects(), "shape")
	if shape.Payload["rotation"] == "" || shape.Payload["rotation"] == "0" {
		t.Errorf("seeded shape rotation = %q, want a nonzero angle", shape.Payload["rotation"])
	}
}

// TestReconcileBuiltIns_FileBackedObjectsWaitForCapturesDir proves the
// ink/image goldens are NOT inserted before a real captures directory
// exists (the construction-time reconcile pass runs before main.go's
// WireAtlasStorageDirs) -- a half-built object with no mirrorPath must
// never land in stored state.
func TestReconcileBuiltIns_FileBackedObjectsWaitForCapturesDir(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())
	for _, kind := range []string{"ink", "image"} {
		for _, o := range a.Objects() {
			if o.Kind == kind {
				t.Errorf("kind %q seeded before a captures directory was ever wired: %+v", kind, o)
			}
		}
	}
}

// TestReconcileBuiltIns_SeedsFileBackedObjectsOnceCapturesDirWired
// proves SetCapturesDir's own re-reconcile (goal 0223) materializes
// ink/image onto disk and inserts them, each with a real, non-empty
// mirror file and no leftover seedAsset marker in the stored Payload.
func TestReconcileBuiltIns_SeedsFileBackedObjectsOnceCapturesDirWired(t *testing.T) {
	a := newTestAtlasService(t)
	a.SetCapturesDir(t.TempDir())

	for _, kind := range []string{"ink", "image"} {
		o := findObjectByKind(t, a.Objects(), kind)
		path := o.Payload["mirrorPath"]
		if path == "" {
			t.Errorf("kind %q has no mirrorPath after captures dir was wired", kind)
			continue
		}
		if _, ok := o.Payload[atlas.BoardObjectSeedAssetKey]; ok {
			t.Errorf("kind %q still carries %q in its stored Payload after materialization", kind, atlas.BoardObjectSeedAssetKey)
		}
		data, err := os.ReadFile(path) //nolint:gosec // path came from this same test's own tempdir-backed materialization, not user input
		if err != nil {
			t.Errorf("kind %q mirrorPath %q: %v", kind, path, err)
			continue
		}
		if len(data) == 0 {
			t.Errorf("kind %q mirrorPath %q is empty", kind, path)
		}
	}
}

// TestReconcileBuiltIns_BoardObjectsIdempotentOnSecondRun proves
// reconcile is top-up, not insert-always, for the whole board-object
// family (shape + the three file-backed kinds) -- a second
// construction over the SAME store, with the same captures directory
// wired, must not duplicate any of them.
func TestReconcileBuiltIns_BoardObjectsIdempotentOnSecondRun(t *testing.T) {
	store := servicetest.NewFakeStore()
	dir := t.TempDir()
	first := NewAtlasService(store)
	t.Cleanup(first.CloseAllMirrorWatches)
	first.SetCapturesDir(dir)
	firstCount := len(first.Objects())

	second := NewAtlasService(store)
	t.Cleanup(second.CloseAllMirrorWatches)
	second.SetCapturesDir(dir)

	if got := len(second.Objects()); got != firstCount {
		t.Errorf("Objects() count after second reconcile = %d, want %d (no duplicates)", got, firstCount)
	}
}

// TestReconcileBuiltIns_RespectsBoardObjectTombstone proves a
// deliberately deleted seeded board object is never resurrected by a
// later reconcile pass -- the same delete-tombstone discipline every
// other seeded entity family already carries (goal 0093, extended to
// BoardObject by goal 0223).
func TestReconcileBuiltIns_RespectsBoardObjectTombstone(t *testing.T) {
	store := servicetest.NewFakeStore()
	first := NewAtlasService(store)

	shape := findObjectByKind(t, first.Objects(), "shape")
	if _, err := first.DeleteBoardObject(shape.ID); err != nil {
		t.Fatalf("DeleteBoardObject: %v", err)
	}

	second := NewAtlasService(store)
	for _, o := range second.Objects() {
		if o.ID == shape.ID {
			t.Errorf("reconcile resurrected tombstoned board object %q", shape.ID)
		}
	}
}

// TestUndoDelete_ClearsBoardObjectSeedTombstone proves UndoDelete
// clears a seeded board object's seed tombstone (not just its
// DeletedAt stamp) -- reconstructing the service afterward must still
// find it, the same "undo really did clear the seed tombstone, not
// just the in-memory copy" property the card-family equivalent tests.
func TestUndoDelete_ClearsBoardObjectSeedTombstone(t *testing.T) {
	store := servicetest.NewFakeStore()
	first := NewAtlasService(store)

	shape := findObjectByKind(t, first.Objects(), "shape")
	if _, err := first.DeleteBoardObject(shape.ID); err != nil {
		t.Fatalf("DeleteBoardObject: %v", err)
	}
	if err := first.UndoDelete(nil, nil, []string{shape.ID}); err != nil {
		t.Fatalf("UndoDelete: %v", err)
	}

	second := NewAtlasService(store)
	found := false
	for _, o := range second.Objects() {
		if o.ID == shape.ID {
			found = true
		}
	}
	if !found {
		t.Error("board object seed tombstone survived UndoDelete -- a fresh reconcile still can't see it")
	}
}
