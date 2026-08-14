package buildinfo

import "testing"

// Real values (a real revision, whether the tree was dirty) are
// inherently environment-dependent -- go test's own binary is built the
// same way go build's is, so this only asserts the mechanism doesn't
// panic and produces *a* value, not a specific one.
func TestRead_DoesNotPanic(t *testing.T) {
	bi := Read()
	if len(bi.Revision) > 12 {
		t.Errorf("Revision %q longer than the documented 12-char cap", bi.Revision)
	}
}

// TestRead_BuiltAtIsThisProcessesOwnExecutableMtime (goal 0029): `go
// test` builds and runs a real temporary executable on disk, so
// os.Executable()+os.Stat() must resolve for the test binary exactly as
// it does for a `go build`/`wails3 dev` output -- BuiltAt should come
// back positive, not silently zero.
func TestRead_BuiltAtIsThisProcessesOwnExecutableMtime(t *testing.T) {
	bi := Read()
	if bi.BuiltAt <= 0 {
		t.Fatalf("BuiltAt = %d, want a positive unix-millis mtime (os.Executable/os.Stat should resolve for a real test binary)", bi.BuiltAt)
	}
}
