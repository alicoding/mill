package executionsvc

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// assertNoDBOSPseudoSteps is goal 0021 gap 2's proof, applied to the
// stepped/breakpoint park flow specifically: parkForApproval
// (executionservice_guardrail.go) is the SAME underlying mechanism a
// plain guardrail-policy ask uses (DBOS SetEvent/Recv, both checkpointed
// under the library's own uniform "DBOS." step-name prefix), and the
// existing prefix filter in GetRun (goal 0026's fix, commit 3e0433e)
// already covers it -- this asserts that holds for a STEPPED run too,
// not just an ordinary policy-ask park, since the dogfood pass that
// logged gap 2 explicitly named "parked/stepped runs".
func assertNoDBOSPseudoSteps(t *testing.T, when string, steps []RunStep) {
	t.Helper()
	for _, s := range steps {
		if strings.HasPrefix(s.NodeID, "DBOS.") {
			t.Errorf("%s: GetRun surfaced a DBOS system pseudo-step %q -- must be filtered", when, s.NodeID)
		}
		if s.NodeTypeID == "" {
			t.Errorf("%s: GetRun surfaced a row with no NodeTypeID (NodeID %q) -- renders as a blank checkmark", when, s.NodeID)
		}
	}
}

// Workflow breakpoints (docs/adr/0031, goal 0020) proven end-to-end
// against the seeded "Route an expense by amount" workflow -- "the
// seed IS the proof" (.claude/rules/testing.md). No new seeded workflow
// is added: a breakpoint is runtime guardrail metadata (a Source:debug
// Rule), not part of a workflow's own Nodes/Edges, so shipping a
// DEFAULT breakpoint on a stock example would surprise every fresh
// install with an unexpected pause -- the toggle stays user-driven, and
// this test creates the rule the same way the Inspector's toggle does
// (GuardrailService.CreateRule).

// newBreakpointHarness mirrors newDecisionExecHarness (decisionoutcome_seed_test.go)
// but also returns the GuardrailService, since a breakpoint IS a
// guardrail rule.
func newBreakpointHarness(t *testing.T) (*guardrailsvc.GuardrailService, *ExecutionService) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	_ = configuresvc.NewConfigureService(store, comp, credential.NewInMemory()) // seeds decision.BuiltIn(), wires composition.SetDecisionLookup
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })
	return guard, exec
}

// The core breakpoint proof (docs/adr/0031 items 1/2/4, goal 0020
// acceptance: "Editing an Attribute value at the pause changes what
// flows downstream, proven by the DBOS-backed test via the branch
// taken"): a debug breakpoint on the seeded branch example's Capture
// node parks the run BEFORE the Branch node ever evaluates "amount" --
// started with a low amount (which would naturally reach the Deny
// outcome), the park is edited to a high amount and resumed, and the
// run reaches Approve instead. This is only possible because the edit
// happens strictly before the Branch node reads the value.
func TestBreakpoint_ParkEditResume_ChangesBranchTaken(t *testing.T) {
	guard, exec := newBreakpointHarness(t)
	wfID := findBuiltInWorkflowID(t, exec.comp, "Route an expense by amount")

	rule, err := guard.CreateRule(guardrail.Rule{
		Label: "Breakpoint", Effect: guardrail.EffectAsk, Source: guardrail.SourceDebug,
		WorkflowID: wfID, NodeID: "example-branch-capture",
	})
	if err != nil {
		t.Fatalf("CreateRule (breakpoint): %v", err)
	}
	t.Cleanup(func() { _ = guard.DeleteRule(rule.ID) })

	// Started low (would naturally take the "otherwise" -> Deny arm).
	summary, err := exec.RunWorkflow(wfID, RunKindTest, map[string]string{"amount": "50"})
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status == "SUCCESS" || summary.Status == "ERROR" {
		t.Fatalf("run should have parked at the breakpoint before Branch ever ran, got status %s", summary.Status)
	}

	pending := waitFor(t, "breakpoint park", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})
	if pending.NodeID != "example-branch-capture" {
		t.Fatalf("pending.NodeID = %q, want the breakpointed capture node", pending.NodeID)
	}
	if pending.Source != guardrail.SourceDebug {
		t.Fatalf("pending.Source = %q, want %q (a breakpoint is a debug park, never policy)", pending.Source, guardrail.SourceDebug)
	}
	if pending.Stepped {
		t.Fatal("pending.Stepped = true, want false -- this run was started plain, not stepped")
	}
	if pending.RuleLabel != "Breakpoint" {
		t.Fatalf("pending.RuleLabel = %q, want the breakpoint rule's own label", pending.RuleLabel)
	}

	// Verify GetRun's debug badge data before resolving: the parked
	// step's live status is "awaiting-approval", not yet a recorded
	// guardrail verdict (the checkpoint only writes once evaluation
	// itself completes, which it already has here -- so it should be
	// visible with Source=debug too).
	before, err := exec.GetRun(summary.RunID)
	if err != nil {
		t.Fatalf("GetRun (parked): %v", err)
	}
	var sawParkedDebugStep bool
	for _, s := range before.Steps {
		if s.NodeID == "example-branch-capture" {
			if s.Status != "awaiting-approval" {
				t.Errorf("parked step status = %q, want awaiting-approval", s.Status)
			}
			if s.GuardrailSource != guardrail.SourceDebug {
				t.Errorf("parked step GuardrailSource = %q, want %q", s.GuardrailSource, guardrail.SourceDebug)
			}
			sawParkedDebugStep = true
		}
	}
	if !sawParkedDebugStep {
		t.Fatal("GetRun did not report the breakpointed step at all")
	}

	// Edit-and-resume (item 4): override 'amount' to a high value before
	// resuming -- the Branch node reads Attributes fresh when it runs,
	// AFTER this park, so the edit is what it actually sees.
	if err := exec.ResolveApproval(summary.RunID, pending.NodeID, true, map[string]string{"amount": "999"}, false); err != nil {
		t.Fatalf("ResolveApproval: %v", err)
	}

	final := waitFor(t, "run to succeed", 10*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Status != "SUCCESS" {
			return RunSummary{}, false
		}
		return s, true
	})
	var out decisionOutcomePayload
	if err := json.Unmarshal([]byte(final.Output), &out); err != nil {
		t.Fatalf("run output is not valid JSON: %v (%s)", err, final.Output)
	}
	if out.Category != "approve" {
		t.Fatalf("category = %q, want approve -- the edited amount (999) should have changed the branch taken, not the original low amount (50)", out.Category)
	}
	if score, ok := out.Outputs["score"].(float64); !ok || score != 999 {
		t.Fatalf("outputs.score = %v, want 999 (the EDITED amount, proving the edit -- not the original -- flowed downstream)", out.Outputs["score"])
	}

	// GetRun after resolution: the step's recorded guardrail verdict
	// still carries Source=debug (the checkpoint is immutable), and the
	// step ordering fix (item 3) puts the capture step strictly before
	// the terminal decision-outcome step in ACTUAL executed order.
	after, err := exec.GetRun(summary.RunID)
	if err != nil {
		t.Fatalf("GetRun (final): %v", err)
	}
	captureIdx, outcomeIdx := -1, -1
	for i, s := range after.Steps {
		if s.NodeID == "example-branch-capture" {
			captureIdx = i
			if s.GuardrailSource != guardrail.SourceDebug {
				t.Errorf("resolved step GuardrailSource = %q, want %q (checkpointed, immutable)", s.GuardrailSource, guardrail.SourceDebug)
			}
		}
		if s.NodeTypeID == "decision-outcome" {
			outcomeIdx = i
		}
	}
	if captureIdx == -1 || outcomeIdx == -1 || captureIdx >= outcomeIdx {
		t.Fatalf("executed step order wrong: capture at %d, decision-outcome at %d, want capture strictly before outcome", captureIdx, outcomeIdx)
	}
}

// Step mode (docs/adr/0031 §5): a stepped run parks before EVERY node,
// including a plain ClassNone capture node with no rule of its own --
// this is the direct proof of the ADR's own flagged open question
// (guardrailGate IS already consulted for every non-trigger/non-
// decision node regardless of effect class, execute.go:150 -- so step
// mode only needed to WIDEN the verdict, never widen gate consultation
// itself). Step/Continue/Stop are proven via ResolveApproval's
// continueRun flag: Step keeps parking, Continue runs the rest through.
func TestStepMode_ParksBeforeEveryNode_StepThenContinue(t *testing.T) {
	_, exec := newBreakpointHarness(t)
	wfID := findBuiltInWorkflowID(t, exec.comp, "Route an expense by amount")

	summary, err := exec.RunWorkflowStepped(wfID, map[string]string{"amount": "150"}, "")
	if err != nil {
		t.Fatalf("RunWorkflowStepped: %v", err)
	}
	if summary.Status == "SUCCESS" || summary.Status == "ERROR" {
		t.Fatalf("stepped run must park at its very first node, got status %s", summary.Status)
	}

	// First park: the capture node -- a ClassNone/pure node with no
	// guardrail rule of its own, proving step mode widens the VERDICT,
	// not just consults external-effect nodes.
	pending1 := waitFor(t, "first step park", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})
	if pending1.NodeID != "example-branch-capture" {
		t.Fatalf("first pending.NodeID = %q, want the capture node (no breakpoint rule needed in step mode)", pending1.NodeID)
	}
	if !pending1.Stepped || pending1.Source != guardrail.SourceDebug {
		t.Fatalf("first pending = %+v, want Stepped=true and Source=%q", pending1, guardrail.SourceDebug)
	}

	// The checkpointed guardrail verdict itself must ALSO carry
	// Source=debug -- not just the live pending event -- proving the
	// step-mode override is computed inside the checkpointed step, not
	// applied only to the local in-memory decision (a real bug caught
	// and fixed while writing this test: the override originally ran
	// AFTER execution.RunAsStep had already checkpointed the
	// un-overridden "allow" verdict).
	parkedDetail, err := exec.GetRun(summary.RunID)
	if err != nil {
		t.Fatalf("GetRun (first park): %v", err)
	}
	var sawCheckpointedDebugSource bool
	for _, s := range parkedDetail.Steps {
		if s.NodeID == pending1.NodeID {
			if s.GuardrailSource != guardrail.SourceDebug {
				t.Errorf("checkpointed GuardrailSource = %q, want %q (must reflect the step-mode override, not the pre-override allow)", s.GuardrailSource, guardrail.SourceDebug)
			}
			sawCheckpointedDebugSource = true
		}
	}
	if !sawCheckpointedDebugSource {
		t.Fatal("GetRun did not report the first stepped-mode park at all")
	}
	assertNoDBOSPseudoSteps(t, "GetRun (first stepped park)", parkedDetail.Steps)

	// "Step": advance exactly one node, park again at the next
	// (decision-route has no exec of its own -- Trigger/Decision nodes
	// never checkpoint -- so the next real park is the terminal
	// decision-outcome node).
	if err := exec.ResolveApproval(summary.RunID, pending1.NodeID, true, nil, false); err != nil {
		t.Fatalf("ResolveApproval (step): %v", err)
	}
	pending2 := waitFor(t, "second step park", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil || s.Pending.NodeID == pending1.NodeID {
			return nil, false
		}
		return s.Pending, true
	})
	if pending2.NodeID == pending1.NodeID {
		t.Fatal("Step did not advance to a different node")
	}
	if !pending2.Stepped {
		t.Fatal("second park lost Stepped=true -- Step must not clear step mode")
	}

	// "Continue": clears step mode, the run finishes straight through
	// with no further parks.
	if err := exec.ResolveApproval(summary.RunID, pending2.NodeID, true, nil, true); err != nil {
		t.Fatalf("ResolveApproval (continue): %v", err)
	}
	final := waitFor(t, "run to succeed", 10*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Status != "SUCCESS" {
			return RunSummary{}, false
		}
		return s, true
	})
	if final.Pending != nil {
		t.Fatal("a completed run must not report a pending approval")
	}

	// Final GetRun, after TWO parks/resolutions -- the debugger's most
	// likely inspection point (a finished stepped run) must not leak any
	// of the DBOS system steps either park checkpointed.
	finalDetail, err := exec.GetRun(summary.RunID)
	if err != nil {
		t.Fatalf("GetRun (final): %v", err)
	}
	assertNoDBOSPseudoSteps(t, "GetRun (final, stepped run)", finalDetail.Steps)
}
