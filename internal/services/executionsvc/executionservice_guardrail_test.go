package executionsvc

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// A test-only external-effect node type: executes instantly with no
// network, so the gate's park/approve/deny flow is provable end-to-end
// against a real DBOS runtime without any external dependency.
// Registered once at init (the registry panics on duplicates).
func init() {
	composition.RegisterNodeType(composition.NodeType{
		ID: "test-external-echo", Kind: composition.KindProcess,
		Label:  "Test: external echo",
		Effect: guardrail.ClassExternal,
	}, func(_ composition.Node, ctx composition.ExecContext) (composition.ExecContext, error) {
		ctx.Payload += "[external-executed]"
		return ctx, nil
	})
}

func newGuardedHarness(t *testing.T) (*guardrailsvc.GuardrailService, *ExecutionService, string) {
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

	wf, err := comp.CreateWorkflow("Guarded test workflow", "", []composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual", Position: composition.Position{X: 0, Y: 0}},
		{ID: "n1", NodeTypeID: "test-external-echo", Position: composition.Position{X: 0, Y: 120}},
	}, []composition.Edge{{ID: "e1", Source: "t1", Target: "n1"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	return guard, exec, wf.ID
}

func waitFor[T any](t *testing.T, what string, timeout time.Duration, poll func() (T, bool)) T {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if v, ok := poll(); ok {
			return v
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
	var zero T
	return zero
}

// The full ask flow, denied: an external step with no allow rule parks
// the run durably (RunWorkflow returns immediately -- a Run click never
// hangs on a human), advertises exactly which step wants to run, and a
// deny fails the run closed with the reason recorded.
func TestGuardrail_ExternalStepParks_DenyFailsClosed(t *testing.T) {
	_, exec, wfID := newGuardedHarness(t)

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status == "SUCCESS" || summary.Status == "ERROR" {
		t.Fatalf("run should still be in flight (parked), got status %s", summary.Status)
	}

	pending := waitFor(t, "pending approval", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})
	if pending.NodeID != "n1" || pending.NodeTypeID != "test-external-echo" {
		t.Fatalf("pending = %+v, want node n1 / test-external-echo", pending)
	}

	if err := exec.ResolveApproval(summary.RunID, "n1", false, nil, false); err != nil {
		t.Fatalf("ResolveApproval: %v", err)
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

	detail, err := exec.GetRun(summary.RunID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	for _, s := range detail.Steps {
		if s.NodeID == "n1" {
			if s.GuardrailEffect != "ask" {
				t.Errorf("step guardrail effect = %q, want ask (the recorded verdict)", s.GuardrailEffect)
			}
			if s.Status == "succeeded" {
				t.Error("denied step must not have executed")
			}
		}
	}
}

// The full ask flow, approved: the parked step executes after approval
// and the run completes with the step's real output.
func TestGuardrail_ExternalStepParks_ApproveExecutes(t *testing.T) {
	_, exec, wfID := newGuardedHarness(t)

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	waitFor(t, "pending approval", 10*time.Second, func() (struct{}, bool) {
		s, err := exec.summaryFor(summary.RunID)
		return struct{}{}, err == nil && s.Pending != nil
	})

	if err := exec.ResolveApproval(summary.RunID, "n1", true, nil, false); err != nil {
		t.Fatalf("ResolveApproval: %v", err)
	}

	final := waitFor(t, "run to succeed", 10*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Status != "SUCCESS" {
			return RunSummary{}, false
		}
		return s, true
	})
	if !strings.Contains(final.Output, "[external-executed]") {
		t.Fatalf("final.Output = %q, want the approved step's real output", final.Output)
	}
	if final.Pending != nil {
		t.Error("a completed run must not report a pending approval")
	}

	// The park itself checkpoints DBOS system operations (DBOS.setEvent/
	// DBOS.recv/DBOS.sleep) as steps -- GetRun must never surface them as
	// rows: they would otherwise render as blank, label-less checkmarks above the
	// run's real steps.
	detail, err := exec.GetRun(summary.RunID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	for _, s := range detail.Steps {
		if strings.HasPrefix(s.NodeID, "DBOS.") {
			t.Errorf("GetRun surfaced DBOS system step %q as a run-detail row", s.NodeID)
		}
		if s.NodeTypeID == "" {
			t.Errorf("GetRun surfaced a row with no NodeTypeID (NodeID %q) -- renders as a blank checkmark", s.NodeID)
		}
	}
}

// An explicit allow rule skips the ask entirely (§8: speed is the
// opt-in): the run completes synchronously, and the recorded verdict
// names the rule that skipped it -- the "skipped" state made auditable.
func TestGuardrail_AllowRuleSkipsApproval(t *testing.T) {
	guard, exec, wfID := newGuardedHarness(t)

	rule, err := guard.CreateRule(guardrail.Rule{
		Label: "echo is trusted", Effect: guardrail.EffectAllow, NodeTypeID: "test-external-echo",
	})
	if err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("summary.Status = %s, want synchronous SUCCESS (allow rule should prevent parking)", summary.Status)
	}

	detail, err := exec.GetRun(summary.RunID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	for _, s := range detail.Steps {
		if s.NodeID == "n1" {
			if s.GuardrailEffect != "allow" || s.GuardrailRule != rule.Label {
				t.Errorf("step guardrail = %q/%q, want allow by %q", s.GuardrailEffect, s.GuardrailRule, rule.Label)
			}
		}
	}
}

// A deny rule fails the run immediately -- no park, no approval option.
func TestGuardrail_DenyRuleFailsImmediately(t *testing.T) {
	guard, exec, wfID := newGuardedHarness(t)

	if _, err := guard.CreateRule(guardrail.Rule{
		Label: "no external calls", Effect: guardrail.EffectDeny, NodeTypeID: "test-external-echo",
	}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	final := waitFor(t, "run to fail", 10*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Status != "ERROR" {
			return RunSummary{}, false
		}
		return s, true
	})
	if !strings.Contains(final.Error, "no external calls") {
		t.Fatalf("final.Error = %q, want the denying rule's label", final.Error)
	}
}

// The dry-run tester returns the same verdict the live gate would --
// §8's locked testability requirement, checked against both the default
// and a rule-driven outcome.
func TestGuardrail_TestRulesMatchesLiveVerdict(t *testing.T) {
	guard, _, wfID := newGuardedHarness(t)

	res, err := guard.TestRules(wfID, "n1")
	if err != nil {
		t.Fatalf("TestRules: %v", err)
	}
	if res.Effect != "ask" || res.EffectClass != "external" {
		t.Fatalf("dry-run = %+v, want default ask for an external step", res)
	}

	if _, err := guard.CreateRule(guardrail.Rule{
		Label: "trusted", Effect: guardrail.EffectAllow, NodeTypeID: "test-external-echo",
	}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}
	res, err = guard.TestRules(wfID, "n1")
	if err != nil {
		t.Fatalf("TestRules: %v", err)
	}
	if res.Effect != "allow" || res.RuleLabel != "trusted" {
		t.Fatalf("dry-run after allow rule = %+v, want allow by 'trusted'", res)
	}
}

// The explicit "Wait for approval" node (docs/adr/0022's Update): a
// drawn checkpoint that always parks -- even a blanket allow rule must
// not skip it, since an allow rule relaxes the ambient *policy* ask,
// never a checkpoint the author composed deliberately.
func TestGuardrail_ExplicitWaitNode_ParksEvenWithAllowRule(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	// A blanket allow for the node type -- must be ignored by the
	// explicit checkpoint.
	if _, err := guard.CreateRule(guardrail.Rule{
		Label: "blanket allow", Effect: guardrail.EffectAllow, NodeTypeID: "human-review",
	}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	wf, err := comp.CreateWorkflow("Explicit checkpoint workflow", "", []composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual"},
		{ID: "w1", NodeTypeID: "human-review",
			Config: map[string]string{"message": "double-check before this ships"}},
		{ID: "n2", NodeTypeID: "process-inject-text",
			Config: map[string]string{"text": "[after-checkpoint]", "placement": "append"}},
	}, []composition.Edge{
		{ID: "e1", Source: "t1", Target: "w1"},
		{ID: "e2", Source: "w1", Target: "n2"},
	})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	summary, err := exec.RunWorkflow(wf.ID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status == "SUCCESS" {
		t.Fatal("run completed synchronously -- the explicit checkpoint did not park")
	}

	pending := waitFor(t, "pending approval", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})
	if pending.NodeID != "w1" || pending.RuleLabel != "double-check before this ships" {
		t.Fatalf("pending = %+v, want the checkpoint's own message surfaced", pending)
	}

	if err := exec.ResolveApproval(summary.RunID, "w1", true, nil, false); err != nil {
		t.Fatalf("ResolveApproval: %v", err)
	}
	final := waitFor(t, "run to succeed", 10*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Status != "SUCCESS" {
			return RunSummary{}, false
		}
		return s, true
	})
	if !strings.Contains(final.Output, "[after-checkpoint]") {
		t.Fatalf("final.Output = %q, want the post-checkpoint step's output", final.Output)
	}
}

// The seeded review example end to end (docs/adr/0023, the seed IS the
// proof): parks at the human-review checkpoint; the reviewer's typed
// input flows into the resumed run's Attributes, is read into the
// payload, and passes the ruleset. Denying input (an empty note) would
// fail the "note provided" rule -- also checked.
func TestSeededHumanReviewExample_TypedInputFlowsThrough(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	wfID := findBuiltInWorkflowID(t, comp, "Example: Human review with input")

	// Approve WITH input: the note becomes the payload and passes the
	// ruleset.
	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	pending := waitFor(t, "pending review", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})
	if pending.RuleLabel != "Provide a note for this run, then approve" {
		t.Fatalf("pending.RuleLabel = %q, want the checkpoint's configured message", pending.RuleLabel)
	}
	if err := exec.ResolveApproval(summary.RunID, pending.NodeID, true, map[string]string{"note": "reviewer says hi"}, false); err != nil {
		t.Fatalf("ResolveApproval: %v", err)
	}
	final := waitFor(t, "run to succeed", 10*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Status != "SUCCESS" {
			return RunSummary{}, false
		}
		return s, true
	})
	if final.Output != "reviewer says hi" {
		t.Fatalf("final.Output = %q, want the reviewer's note as the payload", final.Output)
	}

	// Approve WITHOUT input: the empty note fails the ruleset, naming it.
	summary2, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow(2): %v", err)
	}
	pending2 := waitFor(t, "pending review 2", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary2.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})
	if err := exec.ResolveApproval(summary2.RunID, pending2.NodeID, true, nil, false); err != nil {
		t.Fatalf("ResolveApproval(2): %v", err)
	}
	failed := waitFor(t, "run to fail on the ruleset", 10*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary2.RunID)
		if err != nil || s.Status != "ERROR" {
			return RunSummary{}, false
		}
		return s, true
	})
	if !strings.Contains(failed.Error, "note provided") {
		t.Fatalf("failed.Error = %q, want the failing rule named", failed.Error)
	}
}
