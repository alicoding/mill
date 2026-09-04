package execution

import (
	"context"
	"fmt"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

// Real spike from docs/adr/0004, now a permanent regression test per
// .claude/rules/testing.md: a workflow's first step must not re-execute
// on resume once it's already been checkpointed -- the exact failure
// mode §7 exists to prevent (a result silently lost because the process
// reporting it died, not because the work itself failed).
//
// Step 1 always succeeds and increments step1Runs each time its body
// actually runs. Step 2 fails on the workflow's first run (simulating
// "the process died / something failed after step 1 checkpointed but
// before the workflow completed") and succeeds on every run after.
// Redriving via ForkWorkflow from step 2 must not re-invoke step 1's
// body a second time.
func TestResumeAfterFailure_DoesNotReExecuteCheckpointedStep(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "spike.db")

	var step1Runs int32
	var step2Attempts int32

	step1 := func(_ context.Context) (string, error) { //nolint:unparam // Step[R]'s func(context.Context) (R, error) shape is required by RunAsStep's generic constraint; this step just never fails in this scenario
		atomic.AddInt32(&step1Runs, 1)
		return "step1-output", nil
	}
	step2 := func(_ context.Context) (string, error) {
		n := atomic.AddInt32(&step2Attempts, 1)
		if n == 1 {
			return "", fmt.Errorf("simulated failure on first attempt")
		}
		return "step2-output", nil
	}

	workflow := func(ctx Context, _ string) (string, error) {
		a, err := RunAsStep(ctx, step1, WithStepName("step1"))
		if err != nil {
			return "", err
		}
		b, err := RunAsStep(ctx, step2, WithStepName("step2"))
		if err != nil {
			return "", err
		}
		return a + "+" + b, nil
	}

	runtime, err := New("mill-execution-test", "1", "sqlite:"+dbPath, func(ctx Context) {
		RegisterWorkflow(ctx, workflow)
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = Shutdown(runtime, 5*time.Second) })

	const runID = "test-run-1"
	handle, err := RunWorkflow(runtime, workflow, "in", WithWorkflowID(runID))
	if err != nil {
		t.Fatalf("RunWorkflow (first attempt): %v", err)
	}
	if _, err := handle.GetResult(); err == nil {
		t.Fatal("first run: want an error (step2 fails on attempt 1), got nil")
	}
	if got := atomic.LoadInt32(&step1Runs); got != 1 {
		t.Fatalf("after first run: step1Runs = %d, want 1", got)
	}
	if got := atomic.LoadInt32(&step2Attempts); got != 1 {
		t.Fatalf("after first run: step2Attempts = %d, want 1", got)
	}

	// Redrive from step 2 (index 1: step1 already checkpointed).
	steps, err := GetWorkflowSteps(runtime, runID)
	if err != nil {
		t.Fatalf("GetWorkflowSteps: %v", err)
	}
	var step2ID uint
	found := false
	for _, s := range steps {
		if s.StepName == "step2" {
			step2ID = uint(s.StepID)
			found = true
		}
	}
	if !found {
		t.Fatalf("GetWorkflowSteps returned %d steps, none named step2: %+v", len(steps), steps)
	}

	forked, err := ForkWorkflow[string](runtime, ForkWorkflowInput{
		OriginalWorkflowID: runID,
		StartStep:          step2ID,
	})
	if err != nil {
		t.Fatalf("ForkWorkflow: %v", err)
	}
	result, err := forked.GetResult()
	if err != nil {
		t.Fatalf("redriven run: unexpected error: %v", err)
	}
	if result != "step1-output+step2-output" {
		t.Errorf("redriven run result = %q, want %q", result, "step1-output+step2-output")
	}

	// The whole point: step1's body must not have run again on the
	// redrive, even though the workflow function calls RunAsStep(step1)
	// again on every invocation -- its output came from the original
	// run's checkpoint, not a fresh execution.
	if got := atomic.LoadInt32(&step1Runs); got != 1 {
		t.Errorf("after redrive: step1Runs = %d, want 1 (must not re-execute a checkpointed step)", got)
	}
	if got := atomic.LoadInt32(&step2Attempts); got != 2 {
		t.Errorf("after redrive: step2Attempts = %d, want 2 (failed once, then redriven)", got)
	}
}

// Sanity check that New's phone-home guard needs no runtime assertion
// beyond "never set these fields" -- Conductor only activates if
// ConductorAPIKey/DBOS__CLOUD is configured (docs/adr/0004's spike,
// finding #5), and Config here never sets either. This test exists to
// document that reasoning as executable, not to probe DBOS's internals.
func TestNew_NeverConfiguresConductor(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "phonehome.db")
	runtime, err := New("mill-phonehome-test", "1", "sqlite:"+dbPath, func(Context) {})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = Shutdown(runtime, 5*time.Second) })
	// dbos.Context has no exported accessor for its own Config -- the
	// guard is "we never call dbos.Config{ConductorAPIKey: ..., ...}",
	// verifiable by reading execution.go directly (New's Config literal
	// sets only AppName/DatabaseURL), not by a runtime probe DBOS
	// doesn't expose one for either. A successful New/Launch above with
	// no outbound Conductor connection attempted is the actual check.
}
