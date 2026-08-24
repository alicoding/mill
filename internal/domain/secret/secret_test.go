package secret

import "testing"

func TestValidate(t *testing.T) {
	if err := Validate(Entry{Title: "x"}); err != nil {
		t.Fatalf("Validate with title: %v", err)
	}
	if err := Validate(Entry{}); err == nil {
		t.Fatal("Validate with no title should fail")
	}
	if err := Validate(Entry{Title: "   "}); err == nil {
		t.Fatal("Validate with whitespace-only title should fail")
	}
}

func TestToSummary(t *testing.T) {
	e := Entry{ID: "1", Title: "T", Username: "u", Password: "secret-fake", Notes: "n"}
	s := e.ToSummary()
	if s.ID != "1" || s.Title != "T" || s.Username != "u" {
		t.Fatalf("ToSummary = %+v", s)
	}
	// Password/Notes have no field on Summary at all -- this is a
	// compile-time guarantee, not something this test can assert
	// further, which is the point.
}
