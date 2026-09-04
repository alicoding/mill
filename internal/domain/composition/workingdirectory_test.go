package composition

import (
	"os"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/usererror"
)

// sameDirectory reports whether path names the same directory as want,
// whether or not it went through a symlink first -- macOS's own TMPDIR
// sits under one (/var/folders -> /private/var/folders), and whether a
// shell's own pwd/$PWD resolves through it differs by shell (sh's own
// getcwd()-backed pwd does; zsh's built-in tracks the logical,
// unresolved path passed to chdir unless given -P), so device+inode
// identity is the only comparison robust to either.
func sameDirectory(t *testing.T, path, want string) bool {
	t.Helper()
	gotInfo, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat(%q): %v", path, err)
	}
	wantInfo, err := os.Stat(want)
	if err != nil {
		t.Fatalf("Stat(%q): %v", want, err)
	}
	return os.SameFile(gotInfo, wantInfo)
}

// TestResolveWorkingDirectory_Empty_KeepsDefaultDir pins the no-op
// case: an unset field changes nothing about where a step runs.
func TestResolveWorkingDirectory_Empty_KeepsDefaultDir(t *testing.T) {
	got, err := resolveWorkingDirectory("", "/some/default", nil)
	if err != nil {
		t.Fatalf("resolveWorkingDirectory: %v", err)
	}
	if got != "/some/default" {
		t.Errorf("got %q, want the unchanged default %q", got, "/some/default")
	}
}

// TestResolveWorkingDirectory_Template_ExpandsAgainstAttributes proves
// a {name} token resolves against the run's own Attributes, the same
// brace-token substitution sendHTTPRequest applies to a path parameter.
func TestResolveWorkingDirectory_Template_ExpandsAgainstAttributes(t *testing.T) {
	dir := t.TempDir()
	got, err := resolveWorkingDirectory("{folder}", "/unused-default", map[string]any{"folder": dir})
	if err != nil {
		t.Fatalf("resolveWorkingDirectory: %v", err)
	}
	if got != dir {
		t.Errorf("got %q, want the expanded attribute value %q", got, dir)
	}
}

// TestResolveWorkingDirectory_Relative_FailsWithUserError proves a
// relative override never silently runs somewhere else -- it fails the
// step with the documented code and one-sentence message.
func TestResolveWorkingDirectory_Relative_FailsWithUserError(t *testing.T) {
	_, err := resolveWorkingDirectory("relative/path", "/unused-default", nil)
	if err == nil {
		t.Fatal("resolveWorkingDirectory = nil error, want one for a relative path")
	}
	ue, ok := usererror.Of(err)
	if !ok {
		t.Fatalf("err = %v, want a usererror", err)
	}
	if ue.Code != "working-directory-relative" {
		t.Errorf("Code = %q, want working-directory-relative", ue.Code)
	}
	if err.Error() != "The working directory must be an absolute path." {
		t.Errorf("Error() = %q, want the clean one-sentence message", err.Error())
	}
}

// TestResolveWorkingDirectory_Missing_FailsWithUserError proves an
// absolute path that doesn't exist fails the step rather than being
// handed to the process (which would only fail more confusingly, or on
// some shells silently fall back to the caller's own cwd).
func TestResolveWorkingDirectory_Missing_FailsWithUserError(t *testing.T) {
	missing := "/no/such/mill-test-directory-ever"
	_, err := resolveWorkingDirectory(missing, "/unused-default", nil)
	if err == nil {
		t.Fatal("resolveWorkingDirectory = nil error, want one for a missing directory")
	}
	ue, ok := usererror.Of(err)
	if !ok {
		t.Fatalf("err = %v, want a usererror", err)
	}
	if ue.Code != "working-directory-missing" {
		t.Errorf("Code = %q, want working-directory-missing", ue.Code)
	}
	if !strings.Contains(err.Error(), missing) {
		t.Errorf("Error() = %q, want it to name the missing path", err.Error())
	}
}

// TestResolveWorkingDirectory_ExistingAbsolute_IsUsed proves the happy
// path: a real, existing, absolute path is returned as-is.
func TestResolveWorkingDirectory_ExistingAbsolute_IsUsed(t *testing.T) {
	dir := t.TempDir()
	got, err := resolveWorkingDirectory(dir, "/unused-default", nil)
	if err != nil {
		t.Fatalf("resolveWorkingDirectory: %v", err)
	}
	if got != dir {
		t.Errorf("got %q, want %q", got, dir)
	}
}

// TestPreviewWorkingDirectory_NoField_ReportsNotOk pins the preview's
// own no-op: a step with nothing configured leaves the guardrail
// prompt's payload exactly as it was before this field existed.
func TestPreviewWorkingDirectory_NoField_ReportsNotOk(t *testing.T) {
	if _, ok := PreviewWorkingDirectory(Node{Config: map[string]string{}}, ExecContext{}); ok {
		t.Error("PreviewWorkingDirectory ok = true, want false for an unset field")
	}
}

// TestPreviewWorkingDirectory_Template_ExpandsWithoutValidating proves
// the preview shows the same expansion resolveWorkingDirectory would
// use, without requiring the path to exist -- an approver sees the
// step's real choice even for a directory that will fail at run time.
func TestPreviewWorkingDirectory_Template_ExpandsWithoutValidating(t *testing.T) {
	got, ok := PreviewWorkingDirectory(
		Node{Config: map[string]string{"workingDirectory": "{folder}/sub"}},
		ExecContext{Attributes: map[string]any{"folder": "/no/such/dir"}},
	)
	if !ok {
		t.Fatal("PreviewWorkingDirectory ok = false, want true for a configured field")
	}
	if got != "/no/such/dir/sub" {
		t.Errorf("got %q, want the expanded (unvalidated) path", got)
	}
}
