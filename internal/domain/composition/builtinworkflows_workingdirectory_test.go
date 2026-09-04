package composition

import (
	"os"
	"strings"
	"testing"
)

// findBuiltInWorkflow returns the one seeded workflow named by id, or
// fails the test -- the same "read the real seed, not a hand-copied
// stand-in" discipline TestSeededCodeExecutionExample and its siblings
// already follow at the executionsvc layer, applied here for a proof
// that doesn't need a durable run.
func findBuiltInWorkflow(t *testing.T, id string) Workflow {
	t.Helper()
	for _, wf := range BuiltInWorkflows() {
		if wf.ID == id {
			return wf
		}
	}
	t.Fatalf("no seeded workflow %q (seedproof_test.go's registry references an id BuiltInWorkflows() doesn't produce)", id)
	return Workflow{}
}

// TestSeededRunInCapturedFolder_UsesTheFolderAttributeAsCwd proves goal
// 0345's own seed end to end: the shell step's workingDirectory field
// ("{folder}") resolves against the workflow's declared "folder"
// Attribute, and pwd's real output names that directory, not the
// login shell's own default cwd.
func TestSeededRunInCapturedFolder_UsesTheFolderAttributeAsCwd(t *testing.T) {
	restore := notifierFn
	t.Cleanup(func() { notifierFn = restore })
	notifierFn = func(string, string) error { return nil }

	wf := findBuiltInWorkflow(t, "example-run-in-captured-folder-workflow")
	folder := t.TempDir()

	// AttrValues, not the Attribute's own Default: attributesEnv
	// (graph.go) never reads Default at all -- an unsupplied Attribute
	// always starts at its type's zero value ("" for text), so the Run
	// dialog's typed input is what actually supplies a real value, the
	// same shape every other Attribute-driven seed here already has
	// (e.g. "Example: Branch to a decision"'s own amount-typed proof
	// test).
	out, err := ExecuteWorkflow(wf.Nodes, wf.Edges, wf.Attributes, ExecuteOptions{AttrValues: map[string]string{"folder": folder}})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}

	// The transcript is "$ pwd\n<dir>\n\n" (runShellCommandBlock's own
	// join) -- pwd's own output must name the folder Attribute's real
	// directory (device+inode identity, not string equality: macOS's
	// own TMPDIR sits under a symlink).
	lines := strings.Split(strings.TrimSpace(out), "\n")
	got := strings.TrimSpace(lines[len(lines)-1])
	if got == "" {
		t.Fatalf("output = %q, want pwd's own directory line", out)
	}
	if !sameDirectory(t, got, folder) {
		t.Errorf("pwd printed %q, want it to name the folder Attribute's directory %q", got, folder)
	}
	if _, err := os.Stat(got); err != nil {
		t.Errorf("Stat(%q): %v", got, err)
	}
}
