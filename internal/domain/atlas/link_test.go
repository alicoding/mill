package atlas

import "testing"

func TestValidateLink_RequiresFromCardID(t *testing.T) {
	l := Link{ToCardID: "b", LinkKindID: "lk"}
	if err := ValidateLink(l); err == nil {
		t.Error("ValidateLink() with an empty FromCardID = nil, want an error")
	}
}

func TestValidateLink_RequiresToCardID(t *testing.T) {
	l := Link{FromCardID: "a", LinkKindID: "lk"}
	if err := ValidateLink(l); err == nil {
		t.Error("ValidateLink() with an empty ToCardID = nil, want an error")
	}
}

func TestValidateLink_RequiresLinkKindID(t *testing.T) {
	l := Link{FromCardID: "a", ToCardID: "b"}
	if err := ValidateLink(l); err == nil {
		t.Error("ValidateLink() with an empty LinkKindID = nil, want an error")
	}
}

func TestValidateLink_AcceptsWellFormed(t *testing.T) {
	l := Link{FromCardID: "a", ToCardID: "b", LinkKindID: "lk"}
	if err := ValidateLink(l); err != nil {
		t.Errorf("ValidateLink() = %v, want nil", err)
	}
}
