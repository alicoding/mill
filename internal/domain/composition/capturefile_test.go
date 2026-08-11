package composition

import (
	"os"
	"path/filepath"
	"testing"
)

// TestCaptureFile_PayloadMode_ReadsPathFromPayload proves "payload"
// source treats the current payload as the path to read -- what a
// filesystem-watch trigger's changed-path output supplies (docs/SPEC.md
// §3.4).
func TestCaptureFile_PayloadMode_ReadsPathFromPayload(t *testing.T) {
	path := filepath.Join(t.TempDir(), "page.html")
	if err := os.WriteFile(path, []byte("payload-mode contents"), 0o644); err != nil {
		t.Fatal(err)
	}

	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "c", NodeTypeID: "capture-file"},
	})
	if err != nil {
		t.Fatal(err)
	}
	edges := []Edge{{ID: "e", Source: "t", Target: "c"}}

	out, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: path})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if out != "payload-mode contents" {
		t.Errorf("output = %q, want the file's contents", out)
	}
}

// TestCaptureFile_LiteralMode_ReadsConfiguredPath proves "literal"
// source ignores the payload and reads the fixed configured path
// instead.
func TestCaptureFile_LiteralMode_ReadsConfiguredPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "page.html")
	if err := os.WriteFile(path, []byte("literal-mode contents"), 0o644); err != nil {
		t.Fatal(err)
	}

	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "c", NodeTypeID: "capture-file", Config: map[string]string{"source": "literal", "path": path}},
	})
	if err != nil {
		t.Fatal(err)
	}
	edges := []Edge{{ID: "e", Source: "t", Target: "c"}}

	// A payload present but irrelevant in literal mode -- proves the
	// configured path wins, not the payload.
	out, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: "/should/be/ignored"})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if out != "literal-mode contents" {
		t.Errorf("output = %q, want the literally-configured file's contents", out)
	}
}

// TestCaptureFile_MissingFile_Errors and
// TestCaptureFile_EmptyPath_Errors prove the node surfaces
// fileread.Read's own clear errors rather than swallowing them.
func TestCaptureFile_MissingFile_Errors(t *testing.T) {
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "c", NodeTypeID: "capture-file"},
	})
	if err != nil {
		t.Fatal(err)
	}
	edges := []Edge{{ID: "e", Source: "t", Target: "c"}}

	if _, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: filepath.Join(t.TempDir(), "does-not-exist.html")}); err == nil {
		t.Fatal("ExecuteWorkflow() error = nil, want an error for a missing file")
	}
}

func TestCaptureFile_EmptyPath_Errors(t *testing.T) {
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "c", NodeTypeID: "capture-file"},
	})
	if err != nil {
		t.Fatal(err)
	}
	edges := []Edge{{ID: "e", Source: "t", Target: "c"}}

	if _, err := ExecuteWorkflow(nodes, edges, nil); err == nil {
		t.Fatal("ExecuteWorkflow() error = nil, want an error for an empty payload/path")
	}
}
