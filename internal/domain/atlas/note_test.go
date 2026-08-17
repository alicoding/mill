package atlas

import "testing"

func TestValidateNote_RequiresText(t *testing.T) {
	if err := ValidateNote(Note{Text: "  "}); err == nil {
		t.Error("ValidateNote() on blank text = nil error, want an error")
	}
	if err := ValidateNote(Note{Text: "a thought"}); err != nil {
		t.Errorf("ValidateNote() on non-blank text = %v, want nil", err)
	}
}
