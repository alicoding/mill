package executionsvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
)

// Regression: a run of a workflow validation already knew would fail
// (an unset required reference -- "will fail at run time") was allowed
// to start and then failed mid-flight with a step error. The run must
// be refused up front, with the validation issue's own user-facing
// message.
func TestRunWorkflow_UnconfiguredRequiredRef_RefusedBeforeStarting(t *testing.T) {
	exec, comp := newTestExecutionService(t)

	wf, err := comp.CreateWorkflow("Unconfigured decision", "", []composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual"},
		{ID: "n1", NodeTypeID: "decision-outcome", Config: map[string]string{}},
	}, []composition.Edge{{ID: "e1", Source: "t1", Target: "n1"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	_, err = exec.RunWorkflow(wf.ID, RunKindTest, nil)
	if err == nil {
		t.Fatal("expected the run to be refused, not started")
	}
	if !strings.Contains(err.Error(), "can't run yet") {
		t.Errorf("refusal must carry the pre-flight message: %v", err)
	}
	if !strings.Contains(err.Error(), `"Record decision"`) || strings.Contains(err.Error(), "n1") {
		t.Errorf("refusal must name the step by label, never id: %v", err)
	}

	// The refused run never started: no run record exists for it.
	runs, err := exec.ListRunsForWorkflow(wf.ID)
	if err != nil {
		t.Fatalf("ListRunsForWorkflow: %v", err)
	}
	if len(runs) != 0 {
		t.Errorf("refused run left %d run records, want 0", len(runs))
	}
}
