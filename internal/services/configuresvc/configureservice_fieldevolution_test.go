package configuresvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// docs/adr/0040 decisions 1-3, proven at the actual service chokepoint
// (not just typedfield.ValidateFieldEvolution's own unit tests) --
// Decision.Outputs is the update path these exercise; configurelist's
// UpdateList shares the identical helper, proven once more below.

func TestUpdateDecision_RejectsRekey(t *testing.T) {
	cfg := newDecisionHarness(t)
	d, err := cfg.CreateDecision("Mine", decision.CategoryUncategorized,
		[]decision.OutputField{{Key: "a", Label: "A", Type: "text"}}, "")
	if err != nil {
		t.Fatalf("CreateDecision: %v", err)
	}

	_, err = cfg.UpdateDecision(d.ID, d.Label, d.Category,
		[]decision.OutputField{{Key: "b", Label: "A", Type: "text"}}, nil, "")
	if err == nil {
		t.Fatal("UpdateDecision re-keying an existing output returned nil error, want it rejected")
	}
	if !strings.Contains(err.Error(), `"a"`) {
		t.Errorf("UpdateDecision re-key error = %q, want it to name the dropped key %q", err.Error(), "a")
	}
}

func TestUpdateDecision_RejectsInPlaceRetype(t *testing.T) {
	cfg := newDecisionHarness(t)
	d, err := cfg.CreateDecision("Mine", decision.CategoryUncategorized,
		[]decision.OutputField{{Key: "a", Label: "A", Type: "text"}}, "")
	if err != nil {
		t.Fatalf("CreateDecision: %v", err)
	}

	_, err = cfg.UpdateDecision(d.ID, d.Label, d.Category,
		[]decision.OutputField{{Key: "a", Label: "A", Type: "number"}}, nil, "")
	if err == nil {
		t.Fatal("UpdateDecision retyping an existing output in place returned nil error, want it rejected")
	}
}

func TestUpdateDecision_TombstonedDelete_ThenResurrectSameType_Succeeds(t *testing.T) {
	cfg := newDecisionHarness(t)
	d, err := cfg.CreateDecision("Mine", decision.CategoryUncategorized,
		[]decision.OutputField{{Key: "a", Label: "A", Type: "text"}}, "")
	if err != nil {
		t.Fatalf("CreateDecision: %v", err)
	}

	// Delete "a" -- legal only because it's declared as a tombstone in
	// the same call, not just silently omitted.
	deleted, err := cfg.UpdateDecision(d.ID, d.Label, d.Category, nil,
		[]typedfield.FieldTombstone{{Key: "a", Type: "text"}}, "")
	if err != nil {
		t.Fatalf("UpdateDecision (tombstoned delete): %v", err)
	}
	if len(deleted.FieldTombstones) != 1 || deleted.FieldTombstones[0].Key != "a" {
		t.Fatalf("Decision.FieldTombstones after delete = %+v, want one entry for %q", deleted.FieldTombstones, "a")
	}

	// Resurrect "a" at its original type -- legal.
	resurrected, err := cfg.UpdateDecision(d.ID, d.Label, d.Category,
		[]decision.OutputField{{Key: "a", Label: "A again", Type: "text"}}, nil, "")
	if err != nil {
		t.Fatalf("UpdateDecision (resurrect same type): %v", err)
	}
	if len(resurrected.Outputs) != 1 || resurrected.Outputs[0].Key != "a" {
		t.Fatalf("resurrected Decision.Outputs = %+v, want %q back", resurrected.Outputs, "a")
	}
}

func TestUpdateDecision_ResurrectDifferentType_Rejected(t *testing.T) {
	cfg := newDecisionHarness(t)
	d, err := cfg.CreateDecision("Mine", decision.CategoryUncategorized,
		[]decision.OutputField{{Key: "a", Label: "A", Type: "text"}}, "")
	if err != nil {
		t.Fatalf("CreateDecision: %v", err)
	}
	if _, err := cfg.UpdateDecision(d.ID, d.Label, d.Category, nil,
		[]typedfield.FieldTombstone{{Key: "a", Type: "text"}}, ""); err != nil {
		t.Fatalf("UpdateDecision (tombstoned delete): %v", err)
	}

	_, err = cfg.UpdateDecision(d.ID, d.Label, d.Category,
		[]decision.OutputField{{Key: "a", Label: "A", Type: "number"}}, nil, "")
	if err == nil {
		t.Fatal("UpdateDecision resurrecting a tombstoned key under a different type returned nil error, want it rejected")
	}
}

func TestUpdateDecision_AddingANewKey_StaysFree(t *testing.T) {
	cfg := newDecisionHarness(t)
	d, err := cfg.CreateDecision("Mine", decision.CategoryUncategorized,
		[]decision.OutputField{{Key: "a", Label: "A", Type: "text"}}, "")
	if err != nil {
		t.Fatalf("CreateDecision: %v", err)
	}

	updated, err := cfg.UpdateDecision(d.ID, d.Label, d.Category,
		[]decision.OutputField{{Key: "a", Label: "A", Type: "text"}, {Key: "b", Label: "B", Type: "number"}}, nil, "")
	if err != nil {
		t.Fatalf("UpdateDecision adding a new output: %v", err)
	}
	if len(updated.Outputs) != 2 {
		t.Fatalf("Outputs after adding a key = %d, want 2", len(updated.Outputs))
	}
}

// --- List.Columns: the identical typedfield.ValidateFieldEvolution
// call site, proven once more against UpdateList so a second entity's
// own chokepoint (not just Decision's) is covered directly.

func TestUpdateList_RejectsRekey(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	l, err := cfg.CreateList("Mine", "", []typedfield.Field{{Key: "a", Label: "A", Type: typedfield.TypeText}})
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}

	_, err = cfg.UpdateList(l.ID, l.Label, l.Description,
		[]typedfield.Field{{Key: "b", Label: "A", Type: typedfield.TypeText}}, nil)
	if err == nil {
		t.Fatal("UpdateList re-keying an existing column returned nil error, want it rejected")
	}
	if !strings.Contains(err.Error(), `"a"`) {
		t.Errorf("UpdateList re-key error = %q, want it to name the dropped key %q", err.Error(), "a")
	}
}

func TestUpdateList_TombstonedDelete_ThenResurrectDifferentType_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	l, err := cfg.CreateList("Mine", "", []typedfield.Field{{Key: "a", Label: "A", Type: typedfield.TypeText}})
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}

	deleted, err := cfg.UpdateList(l.ID, l.Label, l.Description, nil,
		[]typedfield.FieldTombstone{{Key: "a", Type: typedfield.TypeText}})
	if err != nil {
		t.Fatalf("UpdateList (tombstoned delete): %v", err)
	}
	if len(deleted.FieldTombstones) != 1 {
		t.Fatalf("List.FieldTombstones after delete = %+v, want one entry", deleted.FieldTombstones)
	}

	_, err = cfg.UpdateList(l.ID, l.Label, l.Description,
		[]typedfield.Field{{Key: "a", Label: "A", Type: typedfield.TypeNumber}}, nil)
	if err == nil {
		t.Fatal("UpdateList resurrecting a tombstoned column under a different type returned nil error, want it rejected")
	}
}
