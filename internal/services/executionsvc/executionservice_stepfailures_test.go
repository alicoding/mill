package executionsvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
)

// The integration proof for goal 0051 item 3 against a real DBOS
// runtime: a failed run's checkpointed step is walked and joined back
// to its NodeTypeID/NodeTypeLabel exactly the way GetRun already does,
// reusing test-home-fail (executionservice_home_test.go's own
// deterministic-failure node type) rather than a network-dependent
// external call.
func TestStepFailureBreakdown_CountsFailedStepsByNodeType(t *testing.T) {
	comp, exec := newHomeHarness(t)

	failWF, err := comp.CreateWorkflow("Failing workflow", "", []composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual", Position: composition.Position{X: 0, Y: 0}},
		{ID: "n1", NodeTypeID: "test-home-fail", Position: composition.Position{X: 0, Y: 100}},
	}, []composition.Edge{{ID: "e0", Source: "t1", Target: "n1"}})
	if err != nil {
		t.Fatalf("CreateWorkflow(fail): %v", err)
	}
	okWF, err := comp.CreateWorkflow("Ok workflow", "", []composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual", Position: composition.Position{X: 0, Y: 0}},
		{ID: "n1", NodeTypeID: "process-inject-text", Position: composition.Position{X: 0, Y: 100},
			Config: map[string]string{"text": "ok", "placement": "append"}},
	}, []composition.Edge{{ID: "e0", Source: "t1", Target: "n1"}})
	if err != nil {
		t.Fatalf("CreateWorkflow(ok): %v", err)
	}

	// Two failed runs of the same failing node type, one successful run
	// that must contribute nothing.
	if _, err := exec.RunWorkflow(failWF.ID, RunKindTest, nil); err != nil {
		t.Fatalf("RunWorkflow(fail #1): %v", err)
	}
	if _, err := exec.RunWorkflow(failWF.ID, RunKindTest, nil); err != nil {
		t.Fatalf("RunWorkflow(fail #2): %v", err)
	}
	if _, err := exec.RunWorkflow(okWF.ID, RunKindTest, nil); err != nil {
		t.Fatalf("RunWorkflow(ok): %v", err)
	}

	got, err := exec.StepFailureBreakdown()
	if err != nil {
		t.Fatalf("StepFailureBreakdown: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("StepFailureBreakdown = %+v, want exactly one failing step type", got)
	}
	if got[0].NodeTypeID != "test-home-fail" || got[0].FailureCount != 2 {
		t.Errorf("StepFailureBreakdown[0] = %+v, want NodeTypeID=test-home-fail FailureCount=2", got[0])
	}
	if got[0].NodeTypeLabel != "Test: always fails" {
		t.Errorf("StepFailureBreakdown[0].NodeTypeLabel = %q, want the node type's real Label", got[0].NodeTypeLabel)
	}
}

func TestStepFailureBreakdown_NoFailures_ReturnsEmptyNotError(t *testing.T) {
	comp, exec := newHomeHarness(t)
	wf, err := comp.CreateWorkflow("Ok workflow", "", []composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual", Position: composition.Position{X: 0, Y: 0}},
		{ID: "n1", NodeTypeID: "process-inject-text", Position: composition.Position{X: 0, Y: 100},
			Config: map[string]string{"text": "ok", "placement": "append"}},
	}, []composition.Edge{{ID: "e0", Source: "t1", Target: "n1"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	if _, err := exec.RunWorkflow(wf.ID, RunKindTest, nil); err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}

	got, err := exec.StepFailureBreakdown()
	if err != nil {
		t.Fatalf("StepFailureBreakdown: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("StepFailureBreakdown = %+v, want empty (no failed runs)", got)
	}
}
