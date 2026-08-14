package composition

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// resetRunEvidenceLookup restores lookupRunEvidenceFn to its
// unregistered default -- same t.Cleanup discipline
// listlookup_test.go/codeexec_seed_test.go's own swap helpers already
// use for every other injected lookup*Fn in this package.
func resetRunEvidenceLookup() {
	SetRunEvidenceLookup(func(_ any) (RunEvidence, error) {
		return RunEvidence{}, fmt.Errorf("no run-evidence lookup registered (yet)")
	})
}

func TestProcessRunReceipt_NoLookupRegistered_FailsWithPrefix(t *testing.T) {
	resetRunEvidenceLookup()
	t.Cleanup(resetRunEvidenceLookup)

	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "r", NodeTypeID: "process-run-receipt"},
	})
	if err != nil {
		t.Fatal(err)
	}
	edges := []Edge{{ID: "e", Source: "t", Target: "r"}}

	_, err = ExecuteWorkflow(nodes, edges, nil)
	if err == nil || !strings.Contains(err.Error(), "process-run-receipt: no run-evidence lookup registered") {
		t.Fatalf("err = %v, want a process-run-receipt-prefixed no-lookup error", err)
	}
}

func TestProcessRunReceipt_LookupError_FailsWithPrefix(t *testing.T) {
	SetRunEvidenceLookup(func(_ any) (RunEvidence, error) {
		return RunEvidence{}, fmt.Errorf("boom")
	})
	t.Cleanup(resetRunEvidenceLookup)

	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "r", NodeTypeID: "process-run-receipt"},
	})
	if err != nil {
		t.Fatal(err)
	}
	edges := []Edge{{ID: "e", Source: "t", Target: "r"}}

	_, err = ExecuteWorkflow(nodes, edges, nil)
	if err == nil || !strings.Contains(err.Error(), "process-run-receipt: boom") {
		t.Fatalf("err = %v, want process-run-receipt-prefixed boom, got %v", err, err)
	}
}

// TestProcessRunReceipt_RendersEvidenceAsJSON proves the node marshals
// whatever RunEvidence the lookup hands back into the payload verbatim,
// and that ExecContext.RunContext -- the run's own opaque per-run
// context -- reaches the lookup unchanged (the seam
// executionsvc.runEvidenceLookup actually resolves into a real runID).
func TestProcessRunReceipt_RendersEvidenceAsJSON(t *testing.T) {
	var gotRunCtx any
	SetRunEvidenceLookup(func(runCtx any) (RunEvidence, error) {
		gotRunCtx = runCtx
		return RunEvidence{
			Schema: "mill://schema/receipt/v1", RunID: "run-1", WorkflowID: "wf-1",
			WorkflowLabel: "Test workflow", Version: 2, Kind: "test",
			Steps: []RunEvidenceStep{{StepID: "prior", StepTypeID: "process-inject-text", Status: "succeeded"}},
			Build: RunEvidenceBuild{Version: "1.2.3", Commit: "abc123", Modified: false},
		}, nil
	})
	t.Cleanup(resetRunEvidenceLookup)

	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "r", NodeTypeID: "process-run-receipt"},
	})
	if err != nil {
		t.Fatal(err)
	}
	edges := []Edge{{ID: "e", Source: "t", Target: "r"}}

	sentinel := "opaque-run-context"
	out, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{RunContext: sentinel})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if gotRunCtx != sentinel {
		t.Errorf("lookup received RunContext %v, want the run's own opaque context %v", gotRunCtx, sentinel)
	}

	var evidence RunEvidence
	if err := json.Unmarshal([]byte(out), &evidence); err != nil {
		t.Fatalf("output isn't valid JSON: %v\n%s", err, out)
	}
	if evidence.RunID != "run-1" || evidence.WorkflowID != "wf-1" {
		t.Errorf("evidence = %+v, want RunID run-1 / WorkflowID wf-1", evidence)
	}
	if len(evidence.Steps) != 1 || evidence.Steps[0].StepID != "prior" {
		t.Errorf("evidence.Steps = %+v, want exactly one prior step", evidence.Steps)
	}
	if evidence.Build.Version != "1.2.3" {
		t.Errorf("evidence.Build = %+v, want Version 1.2.3", evidence.Build)
	}
}
