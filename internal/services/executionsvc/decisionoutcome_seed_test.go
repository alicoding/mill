package executionsvc

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// newDecisionExecHarness builds the full stack Decision's execution
// needs -- unlike newGuardedHarness (this package's other harness),
// decision-outcome nodes resolve their Decision through ConfigureService
// (composition.SetDecisionLookup), so this one also constructs a real
// ConfigureService, which is what actually seeds decision.BuiltIn()'s
// three example Decisions the seeded workflows below reference.
func newDecisionExecHarness(t *testing.T) (*configuresvc.ConfigureService, *ExecutionService) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, credential.New())
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })
	return cfg, exec
}

type decisionOutcomePayload struct {
	Category string         `json:"category"`
	Decision string         `json:"decision"`
	Outputs  map[string]any `json:"outputs"`
}

// The seeded branch example end to end (docs/adr/0027, "the seed IS the
// proof"): captures a typed 'amount' Attribute, a Branch node
// (decision-route) routes on it, and each arm ends at a real
// Configure-authored, TERMINAL Decision -- the captured amount flows
// typed into the reached Decision's own 'score' output.
func TestSeededBranchToDecisionExample_HighAmount_ApproveOutcome(t *testing.T) {
	_, exec := newDecisionExecHarness(t)
	wfID := findBuiltInWorkflowID(t, exec.comp, "Example: Branch to a decision")

	summary, err := exec.RunWorkflow(wfID, RunKindTest, map[string]string{"amount": "150"})
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("run status = %q (error: %q), want SUCCESS", summary.Status, summary.Error)
	}
	var out decisionOutcomePayload
	if err := json.Unmarshal([]byte(summary.Output), &out); err != nil {
		t.Fatalf("run output is not valid JSON: %v (%s)", err, summary.Output)
	}
	if out.Category != "approve" {
		t.Fatalf("category = %q, want approve (amount 150 > 100)", out.Category)
	}
	if score, ok := out.Outputs["score"].(float64); !ok || score != 150 {
		t.Fatalf("outputs.score = %v (%T), want a JSON number 150 (the typed 'amount' Attribute, bound via outputBindings)", out.Outputs["score"], out.Outputs["score"])
	}
}

func TestSeededBranchToDecisionExample_LowAmount_DenyOutcome(t *testing.T) {
	_, exec := newDecisionExecHarness(t)
	wfID := findBuiltInWorkflowID(t, exec.comp, "Example: Branch to a decision")

	summary, err := exec.RunWorkflow(wfID, RunKindTest, map[string]string{"amount": "50"})
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status != "SUCCESS" {
		t.Fatalf("run status = %q (error: %q), want SUCCESS", summary.Status, summary.Error)
	}
	var out decisionOutcomePayload
	if err := json.Unmarshal([]byte(summary.Output), &out); err != nil {
		t.Fatalf("run output is not valid JSON: %v (%s)", err, summary.Output)
	}
	if out.Category != "deny" {
		t.Fatalf("category = %q, want deny (amount 50 <= 100, the otherwise branch)", out.Category)
	}
	if score, ok := out.Outputs["score"].(float64); !ok || score != 50 {
		t.Fatalf("outputs.score = %v, want 50", out.Outputs["score"])
	}
}

// The seeded manual-review Decision parks the run in the Review queue
// BEFORE terminalizing -- the exact same durable park human-review
// already uses (waitForApprovalFn), nothing new invented. Approve
// resumes to the typed outcome.
func TestSeededDecisionWithReviewExample_Approve_Terminalizes(t *testing.T) {
	_, exec := newDecisionExecHarness(t)
	wfID := findBuiltInWorkflowID(t, exec.comp, "Example: Decision with review")

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
	if pending.NodeTypeID != "decision-outcome" {
		t.Fatalf("pending.NodeTypeID = %q, want decision-outcome", pending.NodeTypeID)
	}
	if !strings.Contains(pending.RuleLabel, "Manual review (example)") {
		t.Fatalf("pending.RuleLabel = %q, want it to name the reached Decision", pending.RuleLabel)
	}

	if err := exec.ResolveApproval(summary.RunID, pending.NodeID, true, nil, false); err != nil {
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
		t.Fatalf("final output is not valid JSON: %v (%s)", err, final.Output)
	}
	if out.Category != "manual-review" {
		t.Fatalf("category = %q, want manual-review", out.Category)
	}
}

// Deny fails the run closed -- the Decision never terminalizes, same
// fail-safe shape every other guardrail/review park already has.
func TestSeededDecisionWithReviewExample_Deny_FailsClosed(t *testing.T) {
	_, exec := newDecisionExecHarness(t)
	wfID := findBuiltInWorkflowID(t, exec.comp, "Example: Decision with review")

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
	if err := exec.ResolveApproval(summary.RunID, pending.NodeID, false, nil, false); err != nil {
		t.Fatalf("ResolveApproval: %v", err)
	}
	final := waitFor(t, "run to fail", 10*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || (s.Status != "ERROR" && s.Status != "MAX_RECOVERY_ATTEMPTS_EXCEEDED") {
			return RunSummary{}, false
		}
		return s, true
	})
	if !strings.Contains(final.Error, "denied") {
		t.Fatalf("final.Error = %q, want a denied guardrail error", final.Error)
	}
}

// The dynamic guardrail effect this brief specifically asked to be
// proven end to end (docs/adr/0027): a decision-outcome node WITHOUT a
// webhook never asks (its own ClassLocal default, matching every other
// local-effect step); the identical node WITH a webhook asks for
// approval by default through the real ambient gate -- not just the
// pure EffectForNode unit test (decisionoutcome_test.go), but the real
// DBOS park/approve/execute path, exactly like integration-http gets
// for the same shape of outbound call.
func TestDecisionOutcome_NoWebhook_NeverAsks_WebhookPresent_AsksAndFiresOnApproval(t *testing.T) {
	var webhookCalled bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		webhookCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	cfg, exec := newDecisionExecHarness(t)

	plain, err := cfg.CreateDecision("No webhook", decision.CategoryUncategorized, nil, "")
	if err != nil {
		t.Fatalf("CreateDecision(plain): %v", err)
	}
	webhookReq, err := cfg.CreateHTTPRequest("E2E webhook target", srv.URL, http.MethodPost, "", httprequest.AuthNone, nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	guarded, err := cfg.CreateDecision("With webhook", decision.CategoryUncategorized, nil, webhookReq.ID)
	if err != nil {
		t.Fatalf("CreateDecision(guarded): %v", err)
	}

	// --- No webhook: never asks, terminalizes immediately. ---
	plainNodes, err := composition.ResolveNodeDefaults([]composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual"},
		{ID: "d1", NodeTypeID: "decision-outcome", Config: map[string]string{"decisionId": plain.ID}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults(plain): %v", err)
	}
	plainWF, err := exec.comp.CreateWorkflow("No-webhook decision test", "", plainNodes,
		[]composition.Edge{{ID: "e1", Source: "t1", Target: "d1"}})
	if err != nil {
		t.Fatalf("CreateWorkflow(plain): %v", err)
	}
	plainSummary, err := exec.RunWorkflow(plainWF.ID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow(plain): %v", err)
	}
	if plainSummary.Status != "SUCCESS" {
		t.Fatalf("no-webhook decision run status = %q, want SUCCESS immediately (never asks)", plainSummary.Status)
	}

	// --- With webhook: asks by default, fires the webhook on approval. ---
	guardedNodes, err := composition.ResolveNodeDefaults([]composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual"},
		{ID: "d1", NodeTypeID: "decision-outcome", Config: map[string]string{"decisionId": guarded.ID}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults(guarded): %v", err)
	}
	guardedWF, err := exec.comp.CreateWorkflow("With-webhook decision test", "", guardedNodes,
		[]composition.Edge{{ID: "e1", Source: "t1", Target: "d1"}})
	if err != nil {
		t.Fatalf("CreateWorkflow(guarded): %v", err)
	}
	guardedSummary, err := exec.RunWorkflow(guardedWF.ID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow(guarded): %v", err)
	}
	pending := waitFor(t, "pending approval", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(guardedSummary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})
	if pending.NodeTypeID != "decision-outcome" {
		t.Fatalf("pending.NodeTypeID = %q, want decision-outcome", pending.NodeTypeID)
	}
	if webhookCalled {
		t.Fatal("the webhook fired BEFORE approval -- the ask must gate the whole step")
	}

	if err := exec.ResolveApproval(guardedSummary.RunID, pending.NodeID, true, nil, false); err != nil {
		t.Fatalf("ResolveApproval: %v", err)
	}
	final := waitFor(t, "run to succeed", 10*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(guardedSummary.RunID)
		if err != nil || s.Status != "SUCCESS" {
			return RunSummary{}, false
		}
		return s, true
	})
	_ = final
	if !webhookCalled {
		t.Fatal("the webhook never fired after approval")
	}
}
