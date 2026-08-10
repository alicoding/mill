package executionsvc

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// docs/adr/0026, goal 0004b: these close the same gap
// guardedhttp_seed_test.go's own header comment names -- running the
// REAL seeded "Example: Run copied code" workflow against a real DBOS
// runtime, not a look-alike fixture, covering the approve path (a real
// command actually executes) and the cancel path (a real process
// actually gets killed, not just marked failed).

// skipUnlessRealDesktopClipboard mirrors
// internal/adapters/clipboard's own identical guard: the seed's final
// step is a real apply-clipboard-write-text, so this test needs the
// same real, non-headless macOS session that adapter's own round-trip
// test requires.
func skipUnlessRealDesktopClipboard(t *testing.T) {
	t.Helper()
	if runtime.GOOS != "darwin" {
		t.Skip("code-execution seed's final apply-clipboard-write-text step needs the real macOS clipboard; skipping on " + runtime.GOOS)
	}
	if os.Getenv("CI") != "" {
		t.Skip("skipping real clipboard round-trip in CI: GitHub's macos-latest runners are headless (no GUI/pasteboard session) -- see internal/adapters/clipboard's own identical guard")
	}
}

// swapExecEnvLookup mirrors swapHTTPRequestLookup (guardedhttp_seed_test.go):
// composition.SetExecEnvLookup is a package-level var with no
// test-scoped accessor, so this file owns the swap/restore discipline.
func swapExecEnvLookup(t *testing.T, fn func(id string) (composition.ResolvedExecEnv, error)) func() {
	t.Helper()
	composition.SetExecEnvLookup(fn)
	return func() {
		composition.SetExecEnvLookup(func(envID string) (composition.ResolvedExecEnv, error) {
			return composition.ResolvedExecEnv{}, fmt.Errorf("no execution environment lookup registered (yet) for id %q", envID)
		})
	}
}

func newTestExecutionService(t *testing.T) (*ExecutionService, *compositionsvc.CompositionService) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })
	return exec, comp
}

func codeStepFrom(t *testing.T, detail RunDetail) RunStep {
	t.Helper()
	for _, s := range detail.Steps {
		if s.NodeTypeID == "code-execution" {
			return s
		}
	}
	t.Fatalf("run %s has no code-execution step in its detail", detail.RunID)
	return RunStep{}
}

// TestSeededCodeExecutionExample_Approve_RunsRealCommandAndWritesClipboard
// proves the real seed end to end: the run parks awaiting approval
// (code-execution's ClassExternal effect), approving it actually
// spawns and runs `echo "hello from mill"` inside the seeded Safe
// Sandbox environment shape, and the whole run -- including the real
// clipboard write -- reaches SUCCESS.
func TestSeededCodeExecutionExample_Approve_RunsRealCommandAndWritesClipboard(t *testing.T) {
	skipUnlessRealDesktopClipboard(t)

	exec, comp := newTestExecutionService(t)

	dir := t.TempDir()
	restore := swapExecEnvLookup(t, func(id string) (composition.ResolvedExecEnv, error) {
		return composition.ResolvedExecEnv{Shell: "zsh", ProfileMode: "clean", Dir: dir, Env: []string{"PATH=/usr/bin:/bin:/usr/sbin:/sbin"}}, nil
	})
	defer restore()

	wfID := findBuiltInWorkflowID(t, comp, "Example: Run copied code")

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}

	pending := waitFor(t, "pending approval", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})
	if pending.NodeTypeID != "code-execution" {
		t.Fatalf("pending.NodeTypeID = %q, want code-execution", pending.NodeTypeID)
	}

	if err := exec.ResolveApproval(summary.RunID, pending.NodeID, true, nil); err != nil {
		t.Fatalf("ResolveApproval(approve): %v", err)
	}

	waitFor(t, "run to succeed", 15*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Status != "SUCCESS" {
			return RunSummary{}, false
		}
		return s, true
	})

	detail, err := exec.GetRun(summary.RunID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	codeStep := codeStepFrom(t, detail)
	if codeStep.Status != "succeeded" {
		t.Errorf("code-execution step status = %q, want succeeded (error: %q)", codeStep.Status, codeStep.Error)
	}
	if !strings.Contains(codeStep.Output, "hello from mill") {
		t.Errorf("code-execution step output = %q, want it to contain %q", codeStep.Output, "hello from mill")
	}
}

// TestSeededCodeExecutionExample_Deny_NeverStartsTheProcess mirrors
// TestSeededGuardedHTTPWorkflow_DenyFailsClosed_NoHTTPCall for
// code-execution: a denied external step must never even resolve its
// ExecEnv, let alone spawn a process.
func TestSeededCodeExecutionExample_Deny_NeverStartsTheProcess(t *testing.T) {
	exec, comp := newTestExecutionService(t)

	var lookupCalled bool
	restore := swapExecEnvLookup(t, func(id string) (composition.ResolvedExecEnv, error) {
		lookupCalled = true
		t.Errorf("execEnv lookup was called with id %q on the DENY path -- a denied external step must never resolve/start its process", id)
		return composition.ResolvedExecEnv{}, nil
	})
	defer restore()

	wfID := findBuiltInWorkflowID(t, comp, "Example: Run copied code")

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	pending := waitFor(t, "pending approval", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})

	if err := exec.ResolveApproval(summary.RunID, pending.NodeID, false, nil); err != nil {
		t.Fatalf("ResolveApproval(deny): %v", err)
	}

	final := waitFor(t, "run to fail", 10*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || (s.Status != "ERROR" && s.Status != "MAX_RECOVERY_ATTEMPTS_EXCEEDED") {
			return RunSummary{}, false
		}
		return s, true
	})
	if !strings.Contains(final.Error, "denied by user") {
		t.Fatalf("final.Error = %q, want a denied-by-user guardrail error", final.Error)
	}
	if lookupCalled {
		t.Error("execEnv lookup was called on the deny path, want it never called")
	}
}

// TestCancelRun_KillsARealRunningProcess proves docs/adr/0026's own
// cancellation design end to end, not just the registry bookkeeping: a
// real `sleep 5`-class process, once approved and running, is really
// killed (the run reaches a terminal state in well under the sleep's
// own duration) -- not just left to run to completion while Mill marks
// the run cancelled underneath it.
func TestCancelRun_KillsARealRunningProcess(t *testing.T) {
	exec, comp := newTestExecutionService(t)

	dir := t.TempDir()
	restore := swapExecEnvLookup(t, func(id string) (composition.ResolvedExecEnv, error) {
		return composition.ResolvedExecEnv{Shell: "sh", ProfileMode: "clean", Dir: dir, Env: []string{"PATH=/bin:/usr/bin"}}, nil
	})
	defer restore()

	const (
		triggerID = "cancel-test-trigger"
		stepID    = "cancel-test-step"
	)
	nodes, err := composition.ResolveNodeDefaults([]composition.Node{
		{ID: triggerID, NodeTypeID: "trigger-manual"},
		{ID: stepID, NodeTypeID: "code-execution", Config: map[string]string{
			"envId": "any-env-id", "source": "literal", "script": "sleep 5 && echo should-not-see-this", "timeoutSeconds": "30",
		}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	wf, err := comp.CreateWorkflow("Cancel test workflow", "", nodes, []composition.Edge{
		{ID: "e0", Source: triggerID, Target: stepID},
	})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	summary, err := exec.RunWorkflow(wf.ID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	pending := waitFor(t, "pending approval", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})
	if err := exec.ResolveApproval(summary.RunID, pending.NodeID, true, nil); err != nil {
		t.Fatalf("ResolveApproval(approve): %v", err)
	}

	// Wait for the process to actually register itself (codeexec.go's
	// registerRunningProcessFn call, executionservice_cancel.go's
	// registerProcess) before cancelling it -- NOT a fixed sleep: DBOS's
	// own resume-after-Send scheduling latency is real and variable
	// (confirmed by a first version of this test flaking on a 500ms
	// sleep -- the approval Recv hadn't even been delivered yet, so
	// CancelRun's own execution.CancelWorkflow interrupted the PARKED
	// Recv instead of a running process, and the step never started at
	// all). Polling the registry directly (whitebox -- same package) is
	// the actual signal that `sleep 5` is genuinely in flight.
	waitFor(t, "code-execution process to register itself", 10*time.Second, func() (bool, bool) {
		exec.cancelMu.Lock()
		n := len(exec.cancelHandles)
		exec.cancelMu.Unlock()
		return n > 0, n > 0
	})

	start := time.Now()
	if err := exec.CancelRun(summary.RunID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	// Wait for the STEP's own checkpointed status, not just the overall
	// run summary's -- the two are written by two independent,
	// unsynchronized paths (execution.CancelWorkflow's direct DB status
	// write vs. the killed step's own RunAsStep checkpoint finishing),
	// confirmed by a real flake this test hit polling the run summary
	// alone: the summary can already read CANCELLED while GetRun's
	// per-step detail still shows "pending" a moment longer.
	detail := waitFor(t, "code-execution step to reach a terminal status", 10*time.Second, func() (RunDetail, bool) {
		d, err := exec.GetRun(summary.RunID)
		if err != nil {
			return RunDetail{}, false
		}
		for _, s := range d.Steps {
			if s.NodeTypeID == "code-execution" && s.Status != "pending" {
				return d, true
			}
		}
		return RunDetail{}, false
	})
	elapsed := time.Since(start)
	// The un-killed sleep would take ~4.5s more to finish on its own
	// (5s minus the 0.5s head start) -- proving elapsed is well under
	// that is what actually distinguishes "really killed" from "Mill
	// just marked it cancelled while the process kept running."
	if elapsed > 3*time.Second {
		t.Errorf("CancelRun took %s to reach a terminal state, want well under the sleep's own ~4.5s remaining duration -- the process may not have really been killed", elapsed)
	}

	codeStep := codeStepFrom(t, detail)
	if codeStep.Status != "cancelled" {
		t.Errorf("code-execution step status = %q, want cancelled (error: %q)", codeStep.Status, codeStep.Error)
	}
}
