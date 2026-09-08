package atlassvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/reference"
)

// TestObjectsReferencing_FindsALiveTable is the board half of goal
// 0392 Decision 3's reference index: a live table object carrying the
// declared listID payload key resolves back to the List it projects.
func TestObjectsReferencing_FindsALiveTable(t *testing.T) {
	a := newTestAtlasService(t)
	o, err := a.CreateBoardObject("table", map[string]string{"listID": "list-under-test", "title": "Vendors"}, atlas.Position{X: 1, Y: 2}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	got := a.ObjectsReferencing("list", "list-under-test")
	if len(got) != 1 || got[0].ObjectID != o.ID || got[0].BoardID != o.ParentID || got[0].Label != "Vendors" {
		t.Fatalf("ObjectsReferencing(list, list-under-test) = %+v, want one ref naming %q", got, o.ID)
	}
}

// TestObjectsReferencing_ExcludesADeletedObject proves the "no explicit
// self-exclusion needed" claim DeleteBoardObject's own comment makes:
// a tombstoned table's reference disappears from the index on its own.
func TestObjectsReferencing_ExcludesADeletedObject(t *testing.T) {
	a := newTestAtlasService(t)
	o, err := a.CreateBoardObject("table", map[string]string{"listID": "list-under-test"}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}
	if _, err := a.DeleteBoardObject(o.ID); err != nil {
		t.Fatalf("DeleteBoardObject: %v", err)
	}

	if got := a.ObjectsReferencing("list", "list-under-test"); len(got) != 0 {
		t.Errorf("ObjectsReferencing after delete = %v, want empty", got)
	}
}

// TestObjectsReferencing_IgnoresKindsWithNoEntityRef proves a kind with
// no declared entityRef (image) never matches, even if its own Payload
// happens to carry a key of the same name under a different meaning.
func TestObjectsReferencing_IgnoresKindsWithNoEntityRef(t *testing.T) {
	a := newTestAtlasService(t)
	if _, err := a.CreateBoardObject("image", map[string]string{"listID": "list-under-test"}, atlas.Position{}, ""); err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	if got := a.ObjectsReferencing("list", "list-under-test"); len(got) != 0 {
		t.Errorf("ObjectsReferencing for a non-entityRef kind = %v, want empty", got)
	}
}

func TestObjectsReferencing_EmptyForBlankID(t *testing.T) {
	a := newTestAtlasService(t)
	if got := a.ObjectsReferencing("list", ""); len(got) != 0 {
		t.Errorf("ObjectsReferencing for a blank id (unconfigured, not dangling) = %v, want empty", got)
	}
}

// TestDeleteBoardObject_ReportsEntityRefKindAndStillUsed is the toast's
// own data source (goal 0392 Decision 2): a table's delete result
// names the entity kind it referenced and whether any other reference
// (through the wired combined index) survives it.
func TestDeleteBoardObject_ReportsEntityRefKindAndStillUsed(t *testing.T) {
	a := newTestAtlasService(t)
	a.WireEntityReferenceIndex(func(entityKind, id string) reference.Refs {
		return reference.Refs{Workflows: []string{"Some workflow"}}
	})
	o, err := a.CreateBoardObject("table", map[string]string{"listID": "list-under-test"}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	result, err := a.DeleteBoardObject(o.ID)
	if err != nil {
		t.Fatalf("DeleteBoardObject: %v", err)
	}
	if result.ObjectKind != "table" {
		t.Errorf("result.ObjectKind = %q, want %q", result.ObjectKind, "table")
	}
	if result.EntityRefKind != "list" {
		t.Errorf("result.EntityRefKind = %q, want %q", result.EntityRefKind, "list")
	}
	if !result.EntityStillUsed {
		t.Error("result.EntityStillUsed = false, want true (the wired index still reports a workflow reference)")
	}
}

// TestDeleteBoardObject_ReportsEntityUnused_WhenNoReferenceSurvives
// proves the sole-reference case: deleting the only object AND finding
// no workflow reference either reports the entity as no longer used.
func TestDeleteBoardObject_ReportsEntityUnused_WhenNoReferenceSurvives(t *testing.T) {
	a := newTestAtlasService(t)
	// No workflow half wired -- board-only, same as this object's own
	// index, wrapped to match entityReferencesFn's combined shape.
	a.WireEntityReferenceIndex(func(entityKind, id string) reference.Refs {
		return reference.Refs{Boards: a.ObjectsReferencing(entityKind, id)}
	})
	o, err := a.CreateBoardObject("table", map[string]string{"listID": "list-under-test"}, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	result, err := a.DeleteBoardObject(o.ID)
	if err != nil {
		t.Fatalf("DeleteBoardObject: %v", err)
	}
	if result.EntityStillUsed {
		t.Error("result.EntityStillUsed = true, want false (no board object or workflow references it anymore)")
	}
}

// TestDeleteBoardObject_NonEntityKind_ReportsNoEntityRefKind proves a
// kind with no entityRef (ink) never sets EntityRefKind -- the toast
// then renders its ordinary copy, no entity-outcome segment.
func TestDeleteBoardObject_NonEntityKind_ReportsNoEntityRefKind(t *testing.T) {
	a := newTestAtlasService(t)
	o, err := a.CreateBoardObject("ink", nil, atlas.Position{}, "")
	if err != nil {
		t.Fatalf("CreateBoardObject: %v", err)
	}

	result, err := a.DeleteBoardObject(o.ID)
	if err != nil {
		t.Fatalf("DeleteBoardObject: %v", err)
	}
	if result.EntityRefKind != "" {
		t.Errorf("result.EntityRefKind = %q, want empty for an ink object", result.EntityRefKind)
	}
}
