package atlas

import "testing"

func TestValidateBoardObject_RequiresKind(t *testing.T) {
	if err := ValidateBoardObject(BoardObject{ID: "obj-1", Kind: ""}); err == nil {
		t.Fatal("expected an error for an empty kind")
	}
	if err := ValidateBoardObject(BoardObject{ID: "obj-1", Kind: "   "}); err == nil {
		t.Fatal("expected an error for a whitespace-only kind")
	}
}

func TestValidateBoardObject_AcceptsAnyNonEmptyKind(t *testing.T) {
	// Deliberately not a closed enum (this package's own header
	// comment): a new kind is a Payload-key convention, never a schema
	// change here.
	for _, kind := range []string{"image", "ink", "shape"} {
		if err := ValidateBoardObject(BoardObject{ID: "obj-1", Kind: kind, Payload: map[string]string{"mirrorPath": "/tmp/x"}}); err != nil {
			t.Fatalf("kind %q: unexpected error: %v", kind, err)
		}
	}
}
