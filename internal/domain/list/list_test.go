package list

import "testing"

func TestValidate_Accepts(t *testing.T) {
	l := List{ID: "l1", Label: "Region codes", Entries: map[string]string{"US": "United States"}}
	if err := Validate(l); err != nil {
		t.Errorf("Validate(valid list) returned error: %v", err)
	}
}

func TestValidate_EmptyEntries_Accepted(t *testing.T) {
	l := List{ID: "l1", Label: "Empty for now"}
	if err := Validate(l); err != nil {
		t.Errorf("Validate(list with no entries yet) returned error: %v, want nil -- an empty list is a valid starting state", err)
	}
}

func TestValidate_EmptyLabel_Rejected(t *testing.T) {
	l := List{ID: "l1", Label: "  "}
	if err := Validate(l); err == nil {
		t.Error("Validate with an empty label returned nil error, want an error")
	}
}
