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

	// No AttrValues at all (goal 0347): the workflow's own declared
	// Default ("/tmp") is what supplies "folder" here, proving a
	// declared Default actually reaches a run instead of the run
	// always needing an explicit override.
	out, err := ExecuteWorkflow(wf.Nodes, wf.Edges, wf.Attributes)
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}

	// The transcript is "$ pwd\n<dir>\n\n" (runShellCommandBlock's own
	// join) -- pwd's own output must name the folder Attribute's
	// declared default directory (device+inode identity, not string
	// equality: macOS's own /tmp sits under a symlink).
	lines := strings.Split(strings.TrimSpace(out), "\n")
	got := strings.TrimSpace(lines[len(lines)-1])
	if got == "" {
		t.Fatalf("output = %q, want pwd's own directory line", out)
	}
	if !sameDirectory(t, got, "/tmp") {
		t.Errorf("pwd printed %q, want it to name the folder Attribute's declared default /tmp", got)
	}
	if _, err := os.Stat(got); err != nil {
		t.Errorf("Stat(%q): %v", got, err)
	}
}
