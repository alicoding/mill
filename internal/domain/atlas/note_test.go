package atlas

import "testing"

// Regression: an empty note is LEGAL -- placement itself is the
// captured meaning (a spatial placeholder typed into later); refusing
// blank text blocked the place-then-type flow.
func TestValidateNote_AllowsEmptyText(t *testing.T) {
	if err := ValidateNote(Note{Text: "  "}); err != nil {
		t.Errorf("ValidateNote() on blank text = %v, want nil", err)
	}
	if err := ValidateNote(Note{Text: ""}); err != nil {
		t.Errorf("ValidateNote() on empty text = %v, want nil", err)
	}
	if err := ValidateNote(Note{Text: "a thought"}); err != nil {
		t.Errorf("ValidateNote() on non-blank text = %v, want nil", err)
	}
}
