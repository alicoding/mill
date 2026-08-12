package executionsvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
)

// A manual TEST run can substitute the input its trigger would have
// supplied (docs/SPEC.md §3.4: a trigger's output IS the workflow's
// input) -- caught live: the owner's first Run of the saved-page seed
// died at capture-file with an empty payload, because only headless
// trigger fires ever passed InitialPayload. RunWorkflowWithPayload is
// the same entrypoint the Run dialog's new Initial-payload field calls.
func TestRunWorkflowWithPayload_TestKind_FlowsIntoCaptureFile(t *testing.T) {
	_, exec := newBreakpointHarness(t)

	wf, err := exec.comp.CreateWorkflow("payload test", "",
		[]composition.Node{
			{ID: "t", NodeTypeID: "trigger-manual", Kind: composition.KindTrigger},
			{ID: "c", NodeTypeID: "capture-file", Kind: composition.KindCapture,
				Config: map[string]string{"source": "payload"}},
		},
		[]composition.Edge{{ID: "e", Source: "t", Target: "c"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	path := filepath.Join(t.TempDir(), "page.html")
	if err := os.WriteFile(path, []byte("<main>hello payload</main>"), 0o600); err != nil {
		t.Fatal(err)
	}

	summary, err := exec.RunWorkflowWithPayload(wf.ID, RunKindTest, nil, path)
	if err != nil {
		t.Fatalf("RunWorkflowWithPayload: %v", err)
	}
	if summary.Error != "" {
		t.Fatalf("run failed: %s", summary.Error)
	}
	if !strings.Contains(summary.Output, "hello payload") {
		t.Fatalf("output %q does not contain the file's content", summary.Output)
	}

	// And the empty-payload case still fails, now self-explanatorily --
	// the exact live failure this feature exists to resolve.
	summary, err = exec.RunWorkflow(wf.ID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if !strings.Contains(summary.Error, "Initial payload") {
		t.Fatalf("empty-payload run error %q should point at the Initial payload remedy", summary.Error)
	}
}
