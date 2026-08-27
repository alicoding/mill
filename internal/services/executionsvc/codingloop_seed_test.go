package executionsvc

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
)

// stubNotifier installs a no-op composition.SetNotifier for the
// duration of the test -- the seed's final apply-notify step otherwise
// fails with "no notifier registered (yet)" outside the real app's own
// wiring.go (which only runs in production), same stub/restore shape
// systemevent_seed_test.go's own SetNotifier swap already establishes.
func stubNotifier(t *testing.T) {
	t.Helper()
	composition.SetNotifier(func(string, string) error { return nil })
	t.Cleanup(func() {
		composition.SetNotifier(func(string, string) error { return fmt.Errorf("no notifier registered (yet)") })
	})
}

// TestSeededCodingLoopExample_Approve_RunsMultiStepCommandAndWritesClipboard
// proves the real "Run from clipboard" seed end to end (docs/goals/0240
// S1, seedproof_test.go's CodingLoopWorkflowID entry): the run parks
// awaiting approval (process-shell-command's ClassExternal effect),
// approving it actually runs a real multi-step payload -- one
// newline-separated step, one &&-joined step -- and the whole run,
// including the real clipboard write, reaches SUCCESS.
func TestSeededCodingLoopExample_Approve_RunsMultiStepCommandAndWritesClipboard(t *testing.T) {
	skipUnlessRealDesktopClipboard(t)
	stubNotifier(t)

	exec, _ := newTestExecutionService(t)

	payload := "echo step-one\necho step-two && echo step-three"
	summary, err := exec.RunWorkflowWithPayload(composition.CodingLoopWorkflowID, RunKindTest, nil, payload)
	if err != nil {
		t.Fatalf("RunWorkflowWithPayload: %v", err)
	}

	pending := waitFor(t, "pending approval", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})
	if pending.NodeTypeID != "process-shell-command" {
		t.Fatalf("pending.NodeTypeID = %q, want process-shell-command", pending.NodeTypeID)
	}
	if pending.NodeID != composition.CodingLoopShellStepID {
		t.Fatalf("pending.NodeID = %q, want the seed's own %q", pending.NodeID, composition.CodingLoopShellStepID)
	}

	if err := exec.ResolveApproval(summary.RunID, pending.NodeID, true, nil, false); err != nil {
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
	var shellStep RunStep
	for _, s := range detail.Steps {
		if s.NodeTypeID == "process-shell-command" {
			shellStep = s
		}
	}
	if shellStep.Status != "succeeded" {
		t.Fatalf("process-shell-command step status = %q, want succeeded (error: %q)", shellStep.Status, shellStep.Error)
	}
	for _, want := range []string{"step-one", "step-two", "step-three"} {
		if !strings.Contains(shellStep.Output, want) {
			t.Errorf("step output = %q, want it to contain %q", shellStep.Output, want)
		}
	}
}

// TestSeededCodingLoopExample_Deny_NeverRunsAnything mirrors the
// code-execution seed's own deny-path proof: a denied external step
// must never spawn anything.
func TestSeededCodingLoopExample_Deny_NeverRunsAnything(t *testing.T) {
	exec, _ := newTestExecutionService(t)

	summary, err := exec.RunWorkflowWithPayload(composition.CodingLoopWorkflowID, RunKindTest, nil, "echo should-never-run")
	if err != nil {
		t.Fatalf("RunWorkflowWithPayload: %v", err)
	}
	pending := waitFor(t, "pending approval", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})

	if err := exec.ResolveApproval(summary.RunID, pending.NodeID, false, nil, false); err != nil {
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
}
