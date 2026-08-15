package versioning

import "testing"

type fakeVersion struct{ n int }

func (v fakeVersion) VersionNumber() int { return v.n }

func TestNextNumber_EmptyStartsAtOne(t *testing.T) {
	if got := NextNumber[fakeVersion](nil); got != 1 {
		t.Errorf("NextNumber(nil) = %d, want 1", got)
	}
}

func TestNextNumber_MaxExistingPlusOne(t *testing.T) {
	versions := []fakeVersion{{1}, {3}, {2}}
	if got := NextNumber(versions); got != 4 {
		t.Errorf("NextNumber = %d, want 4 (max existing + 1, regardless of slice order)", got)
	}
}

func TestNextNumber_NeverCollidesAfterARollback(t *testing.T) {
	// A rollback to an older version (a lower-numbered entry still
	// present) must not cause the next publish to reuse a number.
	versions := []fakeVersion{{1}, {2}, {3}}
	if got := NextNumber(versions); got != 4 {
		t.Errorf("NextNumber after a rollback scenario = %d, want 4", got)
	}
}

func TestByNumber_FindsExistingAndReportsMissing(t *testing.T) {
	versions := []fakeVersion{{1}, {2}}
	if v, ok := ByNumber(versions, 2); !ok || v.n != 2 {
		t.Errorf("ByNumber(2) = %+v, %v, want {2} true", v, ok)
	}
	if _, ok := ByNumber(versions, 99); ok {
		t.Error("ByNumber(99) reported found, want not found")
	}
}
