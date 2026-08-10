package settingssvc

import "testing"

// Real values (a real revision, whether the tree was dirty) are
// inherently environment-dependent -- go test's own binary is built
// the same way go build's is, so this only asserts the mechanism
// doesn't panic and produces *a* value, not a specific one.
func TestReadBuildInfo_DoesNotPanic(t *testing.T) {
	bi := readBuildInfo()
	if len(bi.Revision) > 12 {
		t.Errorf("Revision %q longer than the documented 12-char cap", bi.Revision)
	}
}
