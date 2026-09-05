package executionsvc

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// newEnvironmentRunService builds a service over a trivial one-step
// workflow whose default Environment the test controls -- a run's
// recorded environment is what these cases are about, not what any
// step does with it.
func newEnvironmentRunService(t *testing.T) (*ExecutionService, *compositionsvc.CompositionService, string) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	wf, err := comp.CreateWorkflow("Stage-aware", "", []composition.Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "i", NodeTypeID: "process-inject-text", Config: map[string]string{"text": "done"}},
	}, []composition.Edge{{ID: "e", Source: "t", Target: "i"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guardrailsvc.NewGuardrailService(store, comp))
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })
	exec.SetEnvironmentLabelLookup(func(id string) string {
		return map[string]string{"env-sandbox": "Sandbox", "env-prod": "Production"}[id]
	})
	return exec, comp, wf.ID
}

func TestRunWorkflow_UsesTheWorkflowsDefaultEnvironment(t *testing.T) {
	exec, comp, wfID := newEnvironmentRunService(t)
	if _, err := comp.SetWorkflowDefaultEnvironment(wfID, "env-sandbox"); err != nil {
		t.Fatalf("SetWorkflowDefaultEnvironment: %v", err)
	}

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.EnvironmentID != "env-sandbox" || summary.EnvironmentLabel != "Sandbox" {
		t.Errorf("run environment = %q/%q, want env-sandbox/Sandbox", summary.EnvironmentID, summary.EnvironmentLabel)
	}
}

func TestRunWorkflowInEnvironment_OverridesTheWorkflowsDefault(t *testing.T) {
	exec, comp, wfID := newEnvironmentRunService(t)
	if _, err := comp.SetWorkflowDefaultEnvironment(wfID, "env-sandbox"); err != nil {
		t.Fatalf("SetWorkflowDefaultEnvironment: %v", err)
	}

	summary, err := exec.RunWorkflowInEnvironment(wfID, RunKindTest, nil, "", "env-prod")
	if err != nil {
		t.Fatalf("RunWorkflowInEnvironment: %v", err)
	}
	if summary.EnvironmentID != "env-prod" || summary.EnvironmentLabel != "Production" {
		t.Errorf("run environment = %q/%q, want the override", summary.EnvironmentID, summary.EnvironmentLabel)
	}

	// "None" is a choice, not an absence: an explicit empty override
	// must NOT fall back to the workflow's default.
	none, err := exec.RunWorkflowInEnvironment(wfID, RunKindTest, nil, "", "")
	if err != nil {
		t.Fatalf("RunWorkflowInEnvironment(none): %v", err)
	}
	if none.EnvironmentID != "" {
		t.Errorf("run environment = %q, want none", none.EnvironmentID)
	}
}

// A run's environment is recorded on the run itself, so a redrive or a
// resumed park replays the stage the run started in even after the
// workflow's default has moved on.
func TestRunEnvironment_IsRecordedOnTheRunNotReadBackFromTheWorkflow(t *testing.T) {
	exec, comp, wfID := newEnvironmentRunService(t)
	if _, err := comp.SetWorkflowDefaultEnvironment(wfID, "env-sandbox"); err != nil {
		t.Fatalf("SetWorkflowDefaultEnvironment: %v", err)
	}
	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if _, err := comp.SetWorkflowDefaultEnvironment(wfID, "env-prod"); err != nil {
		t.Fatalf("SetWorkflowDefaultEnvironment: %v", err)
	}
	again, err := exec.GetRun(summary.RunID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if again.EnvironmentID != "env-sandbox" {
		t.Errorf("recorded environment = %q, want the one the run actually started in", again.EnvironmentID)
	}
}

// Pre-flight refuses a run whose request needs a variable the selected
// environment cannot supply, before the run starts.
func TestPreflightRefusal_NamesTheUnresolvedVariable(t *testing.T) {
	composition.SetEnvironmentVarGapCheck(func(requestID, environmentID string) []string {
		if requestID != "req-1" {
			return nil
		}
		if environmentID == "env-sandbox" {
			return nil
		}
		return []string{"API_BASE"}
	})
	t.Cleanup(func() { composition.SetEnvironmentVarGapCheck(nil) })

	nodes := []composition.Node{
		{ID: "t", NodeTypeID: "trigger-manual", Kind: composition.KindTrigger},
		{ID: "h", NodeTypeID: "integration-http", Kind: composition.KindProcess, Config: map[string]string{"requestId": "req-1"}},
	}
	edges := []composition.Edge{{ID: "e", Source: "t", Target: "h"}}

	err := preflightRefusal(nodes, edges, nil, "")
	if err == nil || !strings.Contains(err.Error(), "{{API_BASE}}") || !strings.Contains(err.Error(), "no environment is selected") {
		t.Fatalf("preflightRefusal with no environment = %v, want it to name the variable and the missing selection", err)
	}
	err = preflightRefusal(nodes, edges, nil, "env-other")
	if err == nil || !strings.Contains(err.Error(), "the selected environment has no such variable") {
		t.Fatalf("preflightRefusal with a wrong environment = %v, want it to name the gap", err)
	}
	if err := preflightRefusal(nodes, edges, nil, "env-sandbox"); err != nil {
		t.Fatalf("preflightRefusal with the right environment = %v, want nil", err)
	}
}
