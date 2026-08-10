package decision

import "testing"

// Mirrors httprequest's own builtin_test.go discipline: every seeded
// example must itself be a well-formed Decision, or a broken built-in
// silently ships as a bad first impression, not caught by any compiler
// check.
func TestBuiltIn_EveryDecisionIsValid(t *testing.T) {
	for _, d := range BuiltIn() {
		if err := Validate(d); err != nil {
			t.Errorf("BuiltIn() decision %q failed Validate: %v", d.ID, err)
		}
	}
}

func TestBuiltIn_EveryDecisionIsMarkedBuiltIn(t *testing.T) {
	for _, d := range BuiltIn() {
		if !d.BuiltIn {
			t.Errorf("BuiltIn() decision %q has BuiltIn=false, want true", d.ID)
		}
	}
}

func TestBuiltIn_IDsAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, d := range BuiltIn() {
		if seen[d.ID] {
			t.Errorf("BuiltIn() has a duplicate ID: %q", d.ID)
		}
		seen[d.ID] = true
	}
}
