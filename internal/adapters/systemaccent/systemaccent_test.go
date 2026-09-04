package systemaccent

import "testing"

// The platform read itself is OS-bound (testing.md's manual-only
// registry carries it); what is testable here is the seam Read goes
// through, the same package-var-fake shape presencekey_test.go uses.

func TestRead_ReturnsImplResult(t *testing.T) {
	orig := readImpl
	t.Cleanup(func() { readImpl = orig })
	readImpl = func() string { return "rgb(0,122,255)" }

	if got := Read(); got != "rgb(0,122,255)" {
		t.Errorf("Read() = %q, want rgb(0,122,255)", got)
	}
}

func TestRead_EmptyMeansNoAccent(t *testing.T) {
	orig := readImpl
	t.Cleanup(func() { readImpl = orig })
	readImpl = func() string { return "" }

	if got := Read(); got != "" {
		t.Errorf("Read() = %q, want the empty string", got)
	}
}
