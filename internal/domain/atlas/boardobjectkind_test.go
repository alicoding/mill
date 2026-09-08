package atlas

import "testing"

// TestBoardObjectKindDecls_EveryEntityRefDeclaresADeletePolicy is the
// registry-test half of docs/goals/0392 Decision 5: a kind whose
// Payload carries an entity id (EntityRef non-nil) but forgets to
// declare what happens to that entity on delete fails the build,
// rather than shipping a silent per-kind gap the way table's own
// listID reference did before this goal.
func TestBoardObjectKindDecls_EveryEntityRefDeclaresADeletePolicy(t *testing.T) {
	for _, d := range BoardObjectKindDecls() {
		if d.EntityRef == nil {
			continue
		}
		if d.DeleteReference == "" {
			t.Errorf("board-object kind %q declares entityRef %+v but no deleteReference policy", d.Kind, *d.EntityRef)
		}
	}
}

// TestBoardObjectKindDecls_CoverEveryBuiltInKind guards the enforcement
// test above from a false sense of security: a kind present in
// BuiltInBoardObjectKinds() but missing from BoardObjectKindDecls()
// would simply never be checked.
func TestBoardObjectKindDecls_CoverEveryBuiltInKind(t *testing.T) {
	declared := make(map[string]bool)
	for _, d := range BoardObjectKindDecls() {
		declared[d.Kind] = true
	}
	for _, kind := range BuiltInBoardObjectKinds() {
		if !declared[kind] {
			t.Errorf("built-in board-object kind %q has no BoardObjectKindDecl entry", kind)
		}
	}
	for kind := range declared {
		if !IsBuiltInBoardObjectKind(kind) {
			t.Errorf("BoardObjectKindDecl entry %q is not a built-in board-object kind", kind)
		}
	}
}

func TestBoardObjectKindDeclFor_Table(t *testing.T) {
	decl, ok := BoardObjectKindDeclFor("table")
	if !ok {
		t.Fatal("BoardObjectKindDeclFor(\"table\") = not found, want the declared decl")
	}
	if decl.EntityRef == nil || decl.EntityRef.PayloadKey != "listID" || decl.EntityRef.EntityKind != "list" {
		t.Errorf("table's EntityRef = %+v, want {PayloadKey: listID, EntityKind: list}", decl.EntityRef)
	}
	if decl.DeleteReference != DeleteReferenceDetach {
		t.Errorf("table's DeleteReference = %q, want %q", decl.DeleteReference, DeleteReferenceDetach)
	}
}

func TestBoardObjectKindDeclFor_UnknownKind(t *testing.T) {
	if _, ok := BoardObjectKindDeclFor("no-such-kind"); ok {
		t.Error("BoardObjectKindDeclFor on an unknown kind = found, want not found")
	}
}
