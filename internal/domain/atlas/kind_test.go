package atlas

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

func TestValidateKind_RequiresLabel(t *testing.T) {
	if err := ValidateKind(Kind{}); err == nil {
		t.Error("ValidateKind(Kind{}) = nil, want an error for a missing label")
	}
}

func TestValidateKind_RejectsDuplicateFieldKeys(t *testing.T) {
	k := Kind{
		Label: "Example",
		Fields: []typedfield.Field{
			{Key: "email", Type: typedfield.TypeText},
			{Key: "email", Type: typedfield.TypeText},
		},
	}
	if err := ValidateKind(k); err == nil {
		t.Error("ValidateKind() with duplicate field keys = nil, want an error")
	}
}

func TestValidateKind_RejectsInvalidField(t *testing.T) {
	k := Kind{Label: "Example", Fields: []typedfield.Field{{Key: "", Type: typedfield.TypeText}}}
	if err := ValidateKind(k); err == nil {
		t.Error("ValidateKind() with an empty field key = nil, want an error")
	}
}

func TestValidateKind_AcceptsWellFormed(t *testing.T) {
	k := Kind{
		Label: "Example",
		Fields: []typedfield.Field{
			{Key: "email", Type: typedfield.TypeText},
			{Key: "role", Type: typedfield.TypeText},
		},
	}
	if err := ValidateKind(k); err != nil {
		t.Errorf("ValidateKind() = %v, want nil", err)
	}
}

func TestValidateLinkKind_RequiresLabel(t *testing.T) {
	if err := ValidateLinkKind(LinkKind{}); err == nil {
		t.Error("ValidateLinkKind(LinkKind{}) = nil, want an error for a missing label")
	}
}

func TestValidateLinkKind_AcceptsWellFormed(t *testing.T) {
	if err := ValidateLinkKind(LinkKind{Label: "Example relation"}); err != nil {
		t.Errorf("ValidateLinkKind() = %v, want nil", err)
	}
}
