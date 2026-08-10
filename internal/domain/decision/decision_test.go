package decision

import "testing"

func valid() Decision {
	return Decision{
		ID: "d1", Label: "Approve", Category: CategoryApprove,
		Outputs: []OutputField{{Key: "decision", Label: "Decision", Type: "text"}},
	}
}

func TestValidate_Accepts(t *testing.T) {
	if err := Validate(valid()); err != nil {
		t.Errorf("Validate(valid decision) returned error: %v", err)
	}
}

func TestValidate_EmptyLabel_Rejected(t *testing.T) {
	d := valid()
	d.Label = "  "
	if err := Validate(d); err == nil {
		t.Error("Validate with an empty label returned nil error, want an error")
	}
}

func TestValidate_InvalidCategory_Rejected(t *testing.T) {
	d := valid()
	d.Category = "not-a-real-category"
	if err := Validate(d); err == nil {
		t.Error("Validate with an invalid category returned nil error, want an error")
	}
}

func TestValidate_NoOutputs_Accepted(t *testing.T) {
	d := valid()
	d.Outputs = nil
	if err := Validate(d); err != nil {
		t.Errorf("Validate with no output fields returned error: %v, want nil -- outputs are optional", err)
	}
}

func TestValidate_EmptyOutputKey_Rejected(t *testing.T) {
	d := valid()
	d.Outputs = []OutputField{{Key: "  ", Label: "x", Type: "text"}}
	if err := Validate(d); err == nil {
		t.Error("Validate with an empty output key returned nil error, want an error")
	}
}

func TestValidate_DuplicateOutputKey_Rejected(t *testing.T) {
	d := valid()
	d.Outputs = []OutputField{
		{Key: "score", Label: "Score", Type: "number"},
		{Key: "score", Label: "Score again", Type: "number"},
	}
	if err := Validate(d); err == nil {
		t.Error("Validate with a duplicate output key returned nil error, want an error")
	}
}

func TestValidate_EveryCategory_Accepted(t *testing.T) {
	for _, c := range []Category{CategoryApprove, CategoryDeny, CategoryManualReview, CategoryActionNeeded, CategoryUncategorized} {
		d := valid()
		d.Category = c
		if err := Validate(d); err != nil {
			t.Errorf("Validate with category %q returned error: %v", c, err)
		}
	}
}
