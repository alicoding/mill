package executionsvc

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// docs/goals/0010 item 2: "Example: Disabled schedule" had zero tests
// beyond structural (the audit's own finding) -- these two cover the
// two run-kind halves of ADR-0021's lifecycle semantics against the
// REAL seed. The third half (enabling arms the real listener) needs
// TriggerService, which this package can't import without creating an
// executionsvc<->triggersvc import cycle (triggersvc already imports
// executionsvc) -- that one lives in
// internal/services/triggersvc/disabledschedule_seed_test.go instead.

// TestSeededDisabledScheduleExample_TriggeredRunRejectedWhileDisabled
// proves ResolveRunnable's disabled-workflow rejection (versioning.go)
// against the real seed, not a hand-built fixture workflow.
func TestSeededDisabledScheduleExample_TriggeredRunRejectedWhileDisabled(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	wfID := findBuiltInWorkflowID(t, comp, "Example: Disabled schedule")

	if _, err := exec.RunWorkflow(wfID, RunKindTriggered, nil); err == nil {
		t.Fatal("RunWorkflow(triggered) on the disabled seed returned nil error, want it rejected")
	} else if !strings.Contains(err.Error(), "disabled") {
		t.Errorf("RunWorkflow(triggered) error = %q, want it to say the workflow is disabled", err.Error())
	}
}

// TestSeededDisabledScheduleExample_TestRunWorks proves ADR-0021's own
// stated semantics -- "test runs work even while disabled" (the seed's
// own Description) -- actually holds for the real seed: a test run
// executes the draft head regardless of Disabled.
func TestSeededDisabledScheduleExample_TestRunWorks(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	wfID := findBuiltInWorkflowID(t, comp, "Example: Disabled schedule")

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow(test) on the disabled seed returned error, want it to succeed: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("RunWorkflow(test) status = %q, want SUCCESS", summary.Status)
	}
	if !strings.Contains(summary.Output, "the disabled example fired") {
		t.Errorf("RunWorkflow(test) output = %q, want the seed's own inject-text marker", summary.Output)
	}
}
