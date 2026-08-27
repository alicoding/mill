package executionsvc

import (
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
)

// TestSeededCodingLoopExample_AllowListedCommand_RunsUnattended proves
// goal 0240 S3's usability-cliff fix end to end: a payload matching only
// the seed's own default allow list (ls -- kept network-independent,
// unlike curl -I, so the test never depends on real outbound access)
// reaches SUCCESS with NO pending approval ever appearing -- the
// confirm-approval ceremony is genuinely skipped, not just
// auto-resolved.
func TestSeededCodingLoopExample_AllowListedCommand_RunsUnattended(t *testing.T) {
	skipUnlessRealDesktopClipboard(t)
	stubNotifier(t)

	exec, _ := newTestExecutionService(t)

	summary, err := exec.RunWorkflowWithPayload(composition.CodingLoopWorkflowID, RunKindTest, nil, "ls")
	if err != nil {
		t.Fatalf("RunWorkflowWithPayload: %v", err)
	}

	final := waitFor(t, "run to succeed", 15*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Status != "SUCCESS" {
			return RunSummary{}, false
		}
		return s, true
	})
	if final.Pending != nil {
		t.Fatalf("final summary.Pending = %+v, want nil -- an allow-listed command must never park", final.Pending)
	}
}

// TestSeededCodingLoopExample_DenyListedCommand_ParksForApproval proves
// the deny list's "bypass = approve" model: a dangerous shape (rm -rf)
// parks with the deny rule's own label attributed, and approving it
// (the ONLY way past a deny-listed command) lets it actually run.
func TestSeededCodingLoopExample_DenyListedCommand_ParksForApproval(t *testing.T) {
	skipUnlessRealDesktopClipboard(t)
	stubNotifier(t)

	exec, _ := newTestExecutionService(t)

	dir := t.TempDir()
	payload := "rm -rf " + dir + "/does-not-exist"
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
	if !strings.Contains(pending.RuleLabel, "rm -rf") {
		t.Fatalf("pending.RuleLabel = %q, want it to name the deny-listed rule", pending.RuleLabel)
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
}

// TestSeededCodingLoopExample_MixedBlock_AllowStepStillRunsAfterApproval
// proves a mixed block's own display/enforcement split (goal 0240 S3):
// the block still parks as ONE unit because of its deny-listed line, but
// once approved, the allow-listed line runs too (it "still shows in the
// run, just doesn't block" -- it never independently re-asks).
func TestSeededCodingLoopExample_MixedBlock_AllowStepStillRunsAfterApproval(t *testing.T) {
	skipUnlessRealDesktopClipboard(t)
	stubNotifier(t)

	exec, _ := newTestExecutionService(t)

	dir := t.TempDir()
	payload := "ls\nrm -rf " + dir + "/does-not-exist"
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
	if !strings.Contains(shellStep.Output, "$ ls") {
		t.Fatalf("step output = %q, want the allow-listed ls step's own output to be present too", shellStep.Output)
	}
}
