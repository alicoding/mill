package guardrailsvc

import (
	"errors"
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// errFakeGuardrailPersist is the injected failure
// servicetest.FakeStore.SetErr returns for the persist-failure tests
// below (docs/goals/0025 items 1/2) -- a guardrail rule that silently
// failed to save would be worse than most phantom-saved entities: it's
// the thing deciding whether a step needs approval.
var errFakeGuardrailPersist = errors.New("fake persist failure")

// docs/goals/0025 item 3: this package shipped with zero tests despite
// backing the canvas's own nothing-hidden safety badges (docs/adr/0022's
// Update) -- these cover UpdateRule and WorkflowVerdicts, the two
// audited-empty surfaces.

// verdictWorkflow builds a workflow whose node chain exercises every
// case WorkflowVerdicts needs to distinguish: a Trigger root (skipped),
// a read-effect Capture (defaults to allow), an external-effect
// Integration (defaults to ask), and a human-review Process node that
// always parks regardless of any rule (docs/adr/0023). Reused across
// several test cases below so each one only has to vary the rule set.
func verdictWorkflow(t *testing.T, comp *compositionsvc.CompositionService) composition.Workflow {
	t.Helper()
	nodes := []composition.Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "cap", NodeTypeID: "capture-clipboard-html"},
		{ID: "http", NodeTypeID: "integration-http", Config: map[string]string{"requestId": "example-none-httpbin"}},
		{ID: "review", NodeTypeID: "human-review"},
	}
	edges := []composition.Edge{
		{ID: "e1", Source: "t", Target: "cap"},
		{ID: "e2", Source: "cap", Target: "http"},
		{ID: "e3", Source: "http", Target: "review"},
	}
	wf, err := comp.CreateWorkflow("Verdicts test workflow", "", nodes, edges)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	return wf
}

// newTestGuardrailService starts from a genuinely empty rule set, not
// the seeded built-in example (goal 0203 S2's guardrail.BuiltIn) --
// mirrors configuresvc.newTestConfigureService's identical reasoning
// (that helper's own doc comment): NewGuardrailService's constructor
// top-up-seeds guardrail.BuiltIn() on any fresh store, same as every
// other Configure-entity constructor already does for its own goldens,
// so every existing count-based assertion in this package (len(g.
// Rules()) != 1, etc.) would otherwise see one unexpected seeded entry.
// The seeding behavior itself gets its own dedicated test
// (guardrailservice_builtin_test.go), which constructs GuardrailService
// directly rather than through this helper.
func newTestGuardrailService(t *testing.T) (*GuardrailService, *compositionsvc.CompositionService) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	g := NewGuardrailService(store, comp)
	g.rules = nil
	return g, comp
}

// --- WorkflowVerdicts ---

func TestWorkflowVerdicts_UnknownWorkflow_ReturnsError(t *testing.T) {
	g, _ := newTestGuardrailService(t)
	if _, err := g.WorkflowVerdicts("does-not-exist"); err == nil {
		t.Fatal("WorkflowVerdicts() with an unknown workflow id: want error, got nil")
	}
}

// TestWorkflowVerdicts_NoRules_UsesEffectClassDefaults asserts the
// no-rules baseline: a Trigger/Decision node is absent from the result
// entirely (skipped by kind), a read-effect Capture defaults to allow,
// an external-effect Integration defaults to ask, and the always-
// parking human-review node reports ask with the "explicit checkpoint"
// label regardless of there being no rule at all.
func TestWorkflowVerdicts_NoRules_UsesEffectClassDefaults(t *testing.T) {
	g, comp := newTestGuardrailService(t)
	wf := verdictWorkflow(t, comp)

	got, err := g.WorkflowVerdicts(wf.ID)
	if err != nil {
		t.Fatalf("WorkflowVerdicts: %v", err)
	}

	if _, ok := got["t"]; ok {
		t.Errorf("WorkflowVerdicts() included the Trigger node %q, want it skipped", "t")
	}
	if v, ok := got["cap"]; !ok || v.Effect != string(guardrail.EffectAllow) {
		t.Errorf("WorkflowVerdicts()[cap] = %+v (ok=%v), want Effect=allow (read-class default)", got["cap"], ok)
	}
	if v, ok := got["http"]; !ok || v.Effect != string(guardrail.EffectAsk) {
		t.Errorf("WorkflowVerdicts()[http] = %+v (ok=%v), want Effect=ask (external-class default)", got["http"], ok)
	}
	if v, ok := got["review"]; !ok || v.Effect != string(guardrail.EffectAsk) || v.RuleLabel != "explicit checkpoint" {
		t.Errorf("WorkflowVerdicts()[review] = %+v (ok=%v), want ask/\"explicit checkpoint\" regardless of rules", got["review"], ok)
	}
}

// TestWorkflowVerdicts_MatchingRuleOverridesDefault_NonMatchingDoesNot
// covers both a real match (a node-type-scoped allow rule silencing the
// external node's ask default) and a real non-match (a rule scoped to
// a DIFFERENT node type must not affect anything) in the same run, so
// the two are directly comparable.
func TestWorkflowVerdicts_MatchingRuleOverridesDefault_NonMatchingDoesNot(t *testing.T) {
	g, comp := newTestGuardrailService(t)
	wf := verdictWorkflow(t, comp)

	if _, err := g.CreateRule(guardrail.Rule{
		Label: "Allow this HTTP call", Effect: guardrail.EffectAllow, NodeTypeID: "integration-http",
	}); err != nil {
		t.Fatalf("CreateRule (matching): %v", err)
	}
	if _, err := g.CreateRule(guardrail.Rule{
		Label: "Deny some other node type", Effect: guardrail.EffectDeny, NodeTypeID: "mcp-tool-call",
	}); err != nil {
		t.Fatalf("CreateRule (non-matching): %v", err)
	}

	got, err := g.WorkflowVerdicts(wf.ID)
	if err != nil {
		t.Fatalf("WorkflowVerdicts: %v", err)
	}

	if v := got["http"]; v.Effect != string(guardrail.EffectAllow) || v.RuleLabel != "Allow this HTTP call" {
		t.Errorf("WorkflowVerdicts()[http] = %+v, want the matching allow rule to win over the ask default", v)
	}
	if v := got["cap"]; v.Effect != string(guardrail.EffectAllow) || v.RuleLabel != "" {
		t.Errorf("WorkflowVerdicts()[cap] = %+v, want the read-class default untouched by a rule scoped to a different node type", v)
	}
}

// TestWorkflowVerdicts_EffectPrecedence_DenyBeatsAskBeatsAllow asserts
// ADR-0019's categorical precedence (deny always wins, then ask, then
// allow) end to end through WorkflowVerdicts, not just the domain
// package's own Evaluate tests -- this is the exact projection the
// canvas safety badge reads.
func TestWorkflowVerdicts_EffectPrecedence_DenyBeatsAskBeatsAllow(t *testing.T) {
	g, comp := newTestGuardrailService(t)
	wf := verdictWorkflow(t, comp)

	// Three rules, all matching the same node, in an order that would
	// give the WRONG answer if Evaluate just returned the first match
	// instead of resolving by precedence.
	if _, err := g.CreateRule(guardrail.Rule{Label: "allow it", Effect: guardrail.EffectAllow, NodeTypeID: "integration-http"}); err != nil {
		t.Fatalf("CreateRule (allow): %v", err)
	}
	if _, err := g.CreateRule(guardrail.Rule{Label: "ask about it", Effect: guardrail.EffectAsk, NodeTypeID: "integration-http"}); err != nil {
		t.Fatalf("CreateRule (ask): %v", err)
	}
	if _, err := g.CreateRule(guardrail.Rule{Label: "deny it", Effect: guardrail.EffectDeny, NodeTypeID: "integration-http"}); err != nil {
		t.Fatalf("CreateRule (deny): %v", err)
	}

	got, err := g.WorkflowVerdicts(wf.ID)
	if err != nil {
		t.Fatalf("WorkflowVerdicts: %v", err)
	}
	if v := got["http"]; v.Effect != string(guardrail.EffectDeny) || v.RuleLabel != "deny it" {
		t.Errorf("WorkflowVerdicts()[http] = %+v, want deny (highest precedence) regardless of rule creation order", v)
	}
}

// TestWorkflowVerdicts_StepScopedRule_OnlyAffectsItsOwnStep proves
// per-node results are actually independent -- a workflow/node-instance
// -scoped rule (docs/adr/0019's third scope) must change only the
// exact step it names, leaving every other node's verdict alone even
// when they share the same NodeTypeID... here scoped narrowly enough
// that it can't accidentally match the wrong node.
func TestWorkflowVerdicts_StepScopedRule_OnlyAffectsItsOwnStep(t *testing.T) {
	g, comp := newTestGuardrailService(t)
	wf := verdictWorkflow(t, comp)

	if _, err := g.CreateRule(guardrail.Rule{
		Label: "Deny this exact step", Effect: guardrail.EffectDeny, WorkflowID: wf.ID, NodeID: "http",
	}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	got, err := g.WorkflowVerdicts(wf.ID)
	if err != nil {
		t.Fatalf("WorkflowVerdicts: %v", err)
	}
	if v := got["http"]; v.Effect != string(guardrail.EffectDeny) {
		t.Errorf("WorkflowVerdicts()[http] = %+v, want the step-scoped deny to apply", v)
	}
	if v := got["cap"]; v.Effect != string(guardrail.EffectAllow) {
		t.Errorf("WorkflowVerdicts()[cap] = %+v, want it untouched by a rule scoped to a different node id", v)
	}
}

// --- UpdateRule ---

func TestUpdateRule_HappyPath_ReplacesInPlace(t *testing.T) {
	g, _ := newTestGuardrailService(t)
	created, err := g.CreateRule(guardrail.Rule{Label: "Original", Effect: guardrail.EffectAsk, NodeTypeID: "integration-http"})
	if err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	updated := created
	updated.Label = "Renamed"
	updated.Effect = guardrail.EffectDeny
	if err := g.UpdateRule(updated); err != nil {
		t.Fatalf("UpdateRule: %v", err)
	}

	rules := g.Rules()
	if len(rules) != 1 {
		t.Fatalf("Rules() after UpdateRule has %d entries, want 1", len(rules))
	}
	if rules[0].Label != "Renamed" || rules[0].Effect != guardrail.EffectDeny {
		t.Errorf("Rules()[0] = %+v, want the updated Label/Effect in place", rules[0])
	}
	if rules[0].ID != created.ID {
		t.Errorf("UpdateRule changed the rule's ID: got %q, want %q", rules[0].ID, created.ID)
	}
}

func TestUpdateRule_UnknownID_ReturnsError(t *testing.T) {
	g, _ := newTestGuardrailService(t)
	err := g.UpdateRule(guardrail.Rule{ID: "does-not-exist", Label: "x", Effect: guardrail.EffectAllow, NodeTypeID: "integration-http"})
	if err == nil {
		t.Fatal("UpdateRule() with an unknown id: want error, got nil")
	}
}

func TestCreateRule_PersistFailure_ReturnsErrorAndDoesNotPhantomSave(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	g := NewGuardrailService(store, comp)
	g.rules = nil // exclude the seeded example (goal 0203 S2) -- newTestGuardrailService's own reasoning

	store.SetErr = errFakeGuardrailPersist
	if _, err := g.CreateRule(guardrail.Rule{Label: "Should not stick", Effect: guardrail.EffectAllow, NodeTypeID: "integration-http"}); err == nil {
		t.Fatal("CreateRule() with a failing store: want error, got nil")
	}

	store.SetErr = nil
	if got := g.Rules(); len(got) != 0 {
		t.Errorf("Rules() after a failed persist = %+v, want empty (no phantom-saved rule)", got)
	}
}

func TestDeleteRule_PersistFailure_ReturnsErrorAndRestoresIt(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	g := NewGuardrailService(store, comp)
	g.rules = nil // exclude the seeded example (goal 0203 S2) -- newTestGuardrailService's own reasoning

	created, err := g.CreateRule(guardrail.Rule{Label: "Should survive the failed delete", Effect: guardrail.EffectAllow, NodeTypeID: "integration-http"})
	if err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	store.SetErr = errFakeGuardrailPersist
	if err := g.DeleteRule(created.ID); err == nil {
		t.Fatal("DeleteRule() with a failing store: want error, got nil")
	}

	store.SetErr = nil
	got := g.Rules()
	if len(got) != 1 || got[0].ID != created.ID {
		t.Errorf("Rules() after a failed DeleteRule = %+v, want %s restored (the removal was not rolled back)", got, created.ID)
	}
}

// --- RulesForStep ---

func TestRulesForStep_UnknownStep_ReturnsNil(t *testing.T) {
	g, _ := newTestGuardrailService(t)
	if got := g.RulesForStep("does-not-exist", "also-not"); got != nil {
		t.Errorf("RulesForStep() for an unknown step = %+v, want nil", got)
	}
}

// TestRulesForStep_MatchesPerScopeField proves every one of the four
// scope fields is checked independently: a rule scoped by NodeTypeID,
// WorkflowID, WorkflowID+NodeID, or RequestID each match the step that
// carries it, while a rule scoped to something the step DOESN'T carry
// (a different node type, a different workflow, a different request)
// is excluded.
func TestRulesForStep_MatchesPerScopeField(t *testing.T) {
	g, comp := newTestGuardrailService(t)
	wf := verdictWorkflow(t, comp)

	byNodeType, err := g.CreateRule(guardrail.Rule{Label: "By node type", Effect: guardrail.EffectAllow, NodeTypeID: "integration-http"})
	if err != nil {
		t.Fatalf("CreateRule (node type): %v", err)
	}
	byWorkflow, err := g.CreateRule(guardrail.Rule{Label: "By workflow", Effect: guardrail.EffectAsk, WorkflowID: wf.ID})
	if err != nil {
		t.Fatalf("CreateRule (workflow): %v", err)
	}
	byStep, err := g.CreateRule(guardrail.Rule{Label: "By exact step", Effect: guardrail.EffectDeny, WorkflowID: wf.ID, NodeID: "http"})
	if err != nil {
		t.Fatalf("CreateRule (step): %v", err)
	}
	byRequest, err := g.CreateRule(guardrail.Rule{Label: "By request", Effect: guardrail.EffectAllow, RequestID: "example-none-httpbin"})
	if err != nil {
		t.Fatalf("CreateRule (request): %v", err)
	}
	if _, err := g.CreateRule(guardrail.Rule{Label: "Different node type", Effect: guardrail.EffectDeny, NodeTypeID: "mcp-tool-call"}); err != nil {
		t.Fatalf("CreateRule (non-matching node type): %v", err)
	}
	if _, err := g.CreateRule(guardrail.Rule{Label: "Different workflow", Effect: guardrail.EffectDeny, WorkflowID: "some-other-workflow"}); err != nil {
		t.Fatalf("CreateRule (non-matching workflow): %v", err)
	}
	if _, err := g.CreateRule(guardrail.Rule{Label: "Different step in the same workflow", Effect: guardrail.EffectDeny, WorkflowID: wf.ID, NodeID: "cap"}); err != nil {
		t.Fatalf("CreateRule (non-matching step): %v", err)
	}
	if _, err := g.CreateRule(guardrail.Rule{Label: "Different request", Effect: guardrail.EffectDeny, RequestID: "some-other-request"}); err != nil {
		t.Fatalf("CreateRule (non-matching request): %v", err)
	}

	got := g.RulesForStep(wf.ID, "http")
	gotIDs := make(map[string]bool)
	for _, r := range got {
		gotIDs[r.ID] = true
	}
	for _, want := range []guardrail.Rule{byNodeType, byWorkflow, byStep, byRequest} {
		if !gotIDs[want.ID] {
			t.Errorf("RulesForStep(%q, %q) missing matching rule %q (%+v)", wf.ID, "http", want.Label, got)
		}
	}
	if len(got) != 4 {
		t.Errorf("RulesForStep(%q, %q) = %d rules, want exactly the 4 matching ones, got %+v", wf.ID, "http", len(got), got)
	}
}

// TestRulesForStep_ExcludesDebugSource proves a breakpoint (Source:
// SourceDebug) never appears in the policy-rule list door 2/3 render --
// SourceDebug rules are the canvas's own step-mode plumbing, not
// authored policy, and must never look editable/removable as one.
func TestRulesForStep_ExcludesDebugSource(t *testing.T) {
	g, comp := newTestGuardrailService(t)
	wf := verdictWorkflow(t, comp)

	if _, err := g.CreateRule(guardrail.Rule{
		Label: "Breakpoint", Effect: guardrail.EffectAsk, WorkflowID: wf.ID, NodeID: "http", Source: guardrail.SourceDebug,
	}); err != nil {
		t.Fatalf("CreateRule (debug): %v", err)
	}
	if _, err := g.CreateRule(guardrail.Rule{
		Label: "Policy rule", Effect: guardrail.EffectAllow, WorkflowID: wf.ID, NodeID: "http",
	}); err != nil {
		t.Fatalf("CreateRule (policy): %v", err)
	}

	got := g.RulesForStep(wf.ID, "http")
	if len(got) != 1 || got[0].Label != "Policy rule" {
		t.Errorf("RulesForStep() = %+v, want only the policy rule, debug rule excluded", got)
	}
}

func TestUpdateRule_InvalidRule_RejectedBeforeAnyStoreChange(t *testing.T) {
	g, _ := newTestGuardrailService(t)
	created, err := g.CreateRule(guardrail.Rule{Label: "Original", Effect: guardrail.EffectAllow, NodeTypeID: "integration-http"})
	if err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	invalid := created
	invalid.Effect = "not-a-real-effect"
	if err := g.UpdateRule(invalid); err == nil {
		t.Fatal("UpdateRule() with an invalid effect: want error, got nil")
	}

	rules := g.Rules()
	if len(rules) != 1 || rules[0].Label != "Original" {
		t.Errorf("Rules() after a rejected UpdateRule = %+v, want the original rule untouched", rules)
	}
}
