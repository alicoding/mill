package atlassvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

// docs/adr/0040 decisions 1-3, proven at atlassvc's own UpdateKind
// chokepoint -- the identical evolution grammar
// configureservice_fieldevolution_test.go already proves against
// Decision.Outputs/List.Columns, applied here to Kind.Fields (goal
// 0063's absorbed 0046 leftover).

func TestUpdateKind_RejectsRekey(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Mine", "", "", []typedfield.Field{{Key: "a", Label: "A", Type: typedfield.TypeText}})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}

	_, err = a.UpdateKind(k.ID, k.Label, k.Description, k.Icon,
		[]typedfield.Field{{Key: "b", Label: "A", Type: typedfield.TypeText}}, nil)
	if err == nil {
		t.Fatal("UpdateKind re-keying an existing field returned nil error, want it rejected")
	}
	if !strings.Contains(err.Error(), `"a"`) {
		t.Errorf("UpdateKind re-key error = %q, want it to name the dropped key %q", err.Error(), "a")
	}
}

func TestUpdateKind_RejectsInPlaceRetype(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Mine", "", "", []typedfield.Field{{Key: "a", Label: "A", Type: typedfield.TypeText}})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}

	_, err = a.UpdateKind(k.ID, k.Label, k.Description, k.Icon,
		[]typedfield.Field{{Key: "a", Label: "A", Type: typedfield.TypeNumber}}, nil)
	if err == nil {
		t.Fatal("UpdateKind retyping an existing field in place returned nil error, want it rejected")
	}
}

func TestUpdateKind_TombstonedDelete_ThenResurrectSameType_Succeeds(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Mine", "", "", []typedfield.Field{{Key: "a", Label: "A", Type: typedfield.TypeText}})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}

	// Delete "a" -- legal only because it's declared as a tombstone in
	// the same call, not just silently omitted.
	deleted, err := a.UpdateKind(k.ID, k.Label, k.Description, k.Icon, nil,
		[]typedfield.FieldTombstone{{Key: "a", Type: typedfield.TypeText}})
	if err != nil {
		t.Fatalf("UpdateKind (tombstoned delete): %v", err)
	}
	if len(deleted.FieldTombstones) != 1 || deleted.FieldTombstones[0].Key != "a" {
		t.Fatalf("Kind.FieldTombstones after delete = %+v, want one entry for %q", deleted.FieldTombstones, "a")
	}

	// Resurrect "a" at its original type -- legal.
	resurrected, err := a.UpdateKind(k.ID, k.Label, k.Description, k.Icon,
		[]typedfield.Field{{Key: "a", Label: "A again", Type: typedfield.TypeText}}, nil)
	if err != nil {
		t.Fatalf("UpdateKind (resurrect same type): %v", err)
	}
	if len(resurrected.Fields) != 1 || resurrected.Fields[0].Key != "a" {
		t.Fatalf("resurrected Kind.Fields = %+v, want %q back", resurrected.Fields, "a")
	}
}

func TestUpdateKind_ResurrectDifferentType_Rejected(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Mine", "", "", []typedfield.Field{{Key: "a", Label: "A", Type: typedfield.TypeText}})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	if _, err := a.UpdateKind(k.ID, k.Label, k.Description, k.Icon, nil,
		[]typedfield.FieldTombstone{{Key: "a", Type: typedfield.TypeText}}); err != nil {
		t.Fatalf("UpdateKind (tombstoned delete): %v", err)
	}

	_, err = a.UpdateKind(k.ID, k.Label, k.Description, k.Icon,
		[]typedfield.Field{{Key: "a", Label: "A", Type: typedfield.TypeNumber}}, nil)
	if err == nil {
		t.Fatal("UpdateKind resurrecting a tombstoned key under a different type returned nil error, want it rejected")
	}
}

func TestUpdateKind_AddingANewKey_StaysFree(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Mine", "", "", []typedfield.Field{{Key: "a", Label: "A", Type: typedfield.TypeText}})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}

	updated, err := a.UpdateKind(k.ID, k.Label, k.Description, k.Icon,
		[]typedfield.Field{{Key: "a", Label: "A", Type: typedfield.TypeText}, {Key: "b", Label: "B", Type: typedfield.TypeNumber}}, nil)
	if err != nil {
		t.Fatalf("UpdateKind adding a new field: %v", err)
	}
	if len(updated.Fields) != 2 {
		t.Fatalf("Fields after adding a key = %d, want 2", len(updated.Fields))
	}
}
