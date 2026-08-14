package composition

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// readWritten reads back path's contents for a test assertion --
// path is always this test file's own t.TempDir()-scoped fixture, not
// external input.
func readWritten(t *testing.T, path string) string {
	t.Helper()
	got, err := os.ReadFile(path) //nolint:gosec // t.TempDir()-scoped test fixture path, not user input
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	return string(got)
}

// applyFileWriteNode builds a resolved trigger -> apply-file-write
// chain with the given config overrides layered on the field defaults,
// ready to run through ExecuteWorkflow.
func applyFileWriteNode(t *testing.T, overrides map[string]string) ([]Node, []Edge) {
	t.Helper()
	nodes, edges := chain("trigger-manual", "apply-file-write")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	for i := range resolved {
		if resolved[i].NodeTypeID != "apply-file-write" {
			continue
		}
		for k, v := range overrides {
			resolved[i].Config[k] = v
		}
	}
	return resolved, edges
}

func TestApplyFileWrite_Append_CreatesFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scratch.md")
	nodes, edges := applyFileWriteNode(t, map[string]string{"path": path})

	out, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: "first entry"})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if out != "first entry" {
		t.Errorf("ExecuteWorkflow result = %q, want the payload passed through unchanged", out)
	}

	got := readWritten(t, path)
	if string(got) != "first entry\n" {
		t.Errorf("file content = %q, want %q", got, "first entry\n")
	}
}

func TestApplyFileWrite_Append_SecondEntryIsBlankLineSeparated(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scratch.md")
	nodes, edges := applyFileWriteNode(t, map[string]string{"path": path})

	if _, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: "first"}); err != nil {
		t.Fatalf("ExecuteWorkflow (first): %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: "second"}); err != nil {
		t.Fatalf("ExecuteWorkflow (second): %v", err)
	}

	got := readWritten(t, path)
	want := "first\n\nsecond\n"
	if string(got) != want {
		t.Errorf("file content = %q, want %q", got, want)
	}
}

func TestApplyFileWrite_Append_TrailingNewlineNotDuplicated(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scratch.md")
	nodes, edges := applyFileWriteNode(t, map[string]string{"path": path})

	if _, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: "already has newline\n"}); err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}

	got := readWritten(t, path)
	if string(got) != "already has newline\n" {
		t.Errorf("file content = %q, want no duplicated newline", got)
	}
}

func TestApplyFileWrite_Append_TimestampDatetime_PrependsStampLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scratch.md")
	nodes, edges := applyFileWriteNode(t, map[string]string{"path": path, "timestamp": "datetime"})

	if _, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: "note"}); err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}

	got := readWritten(t, path)
	// Assert the documented year-month-day hour:minute stamp shape,
	// not the exact minute -- a real clock read racing this test
	// would otherwise make it flaky.
	want := regexp.MustCompile(`^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]\nnote\n$`)
	if !want.MatchString(string(got)) {
		t.Errorf("file content = %q, want it to match %s", got, want)
	}
}

func TestApplyFileWrite_Append_TimestampNone_NoStampLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scratch.md")
	nodes, edges := applyFileWriteNode(t, map[string]string{"path": path, "timestamp": "none"})

	if _, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: "note"}); err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}

	got := readWritten(t, path)
	if string(got) != "note\n" {
		t.Errorf("file content = %q, want no stamp line", got)
	}
}

func TestApplyFileWrite_Append_EmptyPayload_IsNoOp(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scratch.md")
	nodes, edges := applyFileWriteNode(t, map[string]string{"path": path, "createDirs": "false"})

	out, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: ""})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if out != "" {
		t.Errorf("ExecuteWorkflow result = %q, want empty", out)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("os.Stat(path) = %v, want the file to never have been created", err)
	}
}

func TestApplyFileWrite_Overwrite_ReplacesContentVerbatim(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scratch.md")
	if err := os.WriteFile(path, []byte("stale content\nwith a second line\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	nodes, edges := applyFileWriteNode(t, map[string]string{"path": path, "mode": "overwrite"})

	out, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: "fresh"})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if out != "fresh" {
		t.Errorf("ExecuteWorkflow result = %q, want the payload passed through unchanged", out)
	}

	got := readWritten(t, path)
	if string(got) != "fresh" {
		t.Errorf("file content = %q, want %q (verbatim, no added newline)", got, "fresh")
	}
}

func TestApplyFileWrite_Overwrite_EmptyPayload_TruncatesToEmpty(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scratch.md")
	if err := os.WriteFile(path, []byte("stale content"), 0o600); err != nil {
		t.Fatal(err)
	}
	nodes, edges := applyFileWriteNode(t, map[string]string{"path": path, "mode": "overwrite"})

	if _, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: ""}); err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}

	got := readWritten(t, path)
	if len(got) != 0 {
		t.Errorf("file content = %q, want the file truncated to empty", got)
	}
}

func TestApplyFileWrite_CreateDirsTrue_CreatesNestedParents(t *testing.T) {
	path := filepath.Join(t.TempDir(), "a", "b", "c", "scratch.md")
	nodes, edges := applyFileWriteNode(t, map[string]string{"path": path})

	if _, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: "note"}); err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("os.Stat(path) = %v, want the nested file to exist", err)
	}
}

func TestApplyFileWrite_CreateDirsFalse_MissingParent_ErrorsWithPrefix(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing-dir", "scratch.md")
	nodes, edges := applyFileWriteNode(t, map[string]string{"path": path, "createDirs": "false"})

	_, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: "note"})
	if err == nil {
		t.Fatal("ExecuteWorkflow() error = nil, want an error for a missing parent folder")
	}
	if want := "apply-file-write: "; !strings.Contains(err.Error(), want) {
		t.Errorf("error = %q, want it to contain %q", err.Error(), want)
	}
}

func TestApplyFileWrite_EmptyPath_Errors(t *testing.T) {
	nodes, edges := applyFileWriteNode(t, nil)

	_, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: "note"})
	if err == nil {
		t.Fatal("ExecuteWorkflow() error = nil, want an error for an empty configured path")
	}
}

func TestResolveFileWritePath_ExpandsTilde(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	got, err := resolveFileWritePath("~/notes/scratch.md")
	if err != nil {
		t.Fatalf("resolveFileWritePath: %v", err)
	}
	want := filepath.Join(home, "notes", "scratch.md")
	if got != want {
		t.Errorf("resolveFileWritePath(~/notes/scratch.md) = %q, want %q", got, want)
	}
}

func TestResolveFileWritePath_BareTilde_ExpandsToHome(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	got, err := resolveFileWritePath("~")
	if err != nil {
		t.Fatalf("resolveFileWritePath: %v", err)
	}
	if got != home {
		t.Errorf("resolveFileWritePath(~) = %q, want %q", got, home)
	}
}

func TestResolveFileWritePath_AbsolutePathUnchanged(t *testing.T) {
	got, err := resolveFileWritePath("/tmp/scratch.md")
	if err != nil {
		t.Fatalf("resolveFileWritePath: %v", err)
	}
	if got != "/tmp/scratch.md" {
		t.Errorf("resolveFileWritePath(/tmp/scratch.md) = %q, want it unchanged", got)
	}
}

func TestResolveFileWritePath_EmptyPath_Errors(t *testing.T) {
	if _, err := resolveFileWritePath(""); err == nil {
		t.Fatal("resolveFileWritePath(\"\") error = nil, want an error")
	}
}
