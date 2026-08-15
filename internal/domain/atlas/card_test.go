package atlas

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

func TestValidateCard_RequiresTitle(t *testing.T) {
	kind := Kind{ID: "k1", Label: "Example"}
	if err := ValidateCard(Card{KindID: "k1"}, kind); err == nil {
		t.Error("ValidateCard() with an empty title = nil, want an error")
	}
}

func TestValidateCard_RequiresKindID(t *testing.T) {
	kind := Kind{ID: "k1", Label: "Example"}
	if err := ValidateCard(Card{Title: "Card"}, kind); err == nil {
		t.Error("ValidateCard() with an empty KindID = nil, want an error")
	}
}

func TestValidateCard_RejectsMismatchedResolvedKind(t *testing.T) {
	kind := Kind{ID: "k1", Label: "Example"}
	c := Card{Title: "Card", KindID: "k2"}
	if err := ValidateCard(c, kind); err == nil {
		t.Error("ValidateCard() whose KindID doesn't match the resolved kind = nil, want an error")
	}
}

func TestValidateCard_RejectsUndeclaredFieldKey(t *testing.T) {
	kind := Kind{ID: "k1", Label: "Example"}
	c := Card{Title: "Card", KindID: "k1", Fields: map[string]string{"unknown": "x"}}
	if err := ValidateCard(c, kind); err == nil {
		t.Error("ValidateCard() with a field key the kind doesn't declare = nil, want an error")
	}
}

func TestValidateCard_AcceptsDeclaredFieldKeys(t *testing.T) {
	kind := Kind{ID: "k1", Label: "Example", Fields: []typedfield.Field{{Key: "email", Type: typedfield.TypeText}}}
	c := Card{Title: "Card", KindID: "k1", Fields: map[string]string{"email": "a@example.com"}}
	if err := ValidateCard(c, kind); err != nil {
		t.Errorf("ValidateCard() = %v, want nil", err)
	}
}

func TestEffectiveViewMode_DefaultsToShelves(t *testing.T) {
	if got := (Card{}).EffectiveViewMode(); got != ViewModeShelves {
		t.Errorf("EffectiveViewMode() on a zero-value Card = %q, want %q", got, ViewModeShelves)
	}
}

func TestEffectiveViewMode_PreservesCanvas(t *testing.T) {
	if got := (Card{ViewMode: ViewModeCanvas}).EffectiveViewMode(); got != ViewModeCanvas {
		t.Errorf("EffectiveViewMode() on a canvas Card = %q, want %q", got, ViewModeCanvas)
	}
}

// TestWouldCycle_RejectsSelfParent and its siblings pin down the
// containment-cycle rejection docs/goals/0061 requires: a card must
// never become its own ancestor.
func TestWouldCycle_RejectsSelfParent(t *testing.T) {
	if !WouldCycle("a", "a", nil) {
		t.Error("WouldCycle(a, a) = false, want true (a card can't be its own parent)")
	}
}

func TestWouldCycle_RejectsIndirectAncestor(t *testing.T) {
	// a -> b -> c; reparenting a under c would make a its own ancestor.
	byID := map[string]Card{
		"b": {ID: "b", ParentID: "a"},
		"c": {ID: "c", ParentID: "b"},
	}
	if !WouldCycle("a", "c", byID) {
		t.Error("WouldCycle(a, c) over a->b->c = false, want true")
	}
}

func TestWouldCycle_AllowsNonAncestorReparent(t *testing.T) {
	byID := map[string]Card{
		"b": {ID: "b", ParentID: ""},
		"c": {ID: "c", ParentID: ""},
	}
	if WouldCycle("a", "c", byID) {
		t.Error("WouldCycle(a, c) with c not an ancestor of a = true, want false")
	}
}

func TestWouldCycle_AllowsRootLevel(t *testing.T) {
	if WouldCycle("a", "", nil) {
		t.Error("WouldCycle(a, \"\") = true, want false (root-level is always allowed)")
	}
}
