package guardrailsvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/compositionsvc"
)

// swapSecretLabelsLookup mirrors executionsvc's swapExecEnvLookup/
// swapHTTPRequestLookup: SetSecretLabelsLookup wires a package-level var
// with no test-scoped accessor, so every test that touches it owns its
// own swap/restore via t.Cleanup, never leaking into a sibling test in
// the same binary.
func swapSecretLabelsLookup(t *testing.T, fn func(nodeTypeID string, config map[string]string) []string) {
	t.Helper()
	SetSecretLabelsLookup(fn)
	t.Cleanup(func() {
		SetSecretLabelsLookup(func(string, map[string]string) []string { return nil })
	})
}

// secretAttrWorkflow builds a two-step workflow for the
// Attributes["secrets"] gate tests below: "withSecret"'s config is the
// one swapSecretLabelsLookup's fake derivation recognizes as using a
// vault entry, "noSecret" is identical in every way except its config,
// which the fake never matches -- isolating the CONDITION as the only
// variable between the two.
func secretAttrWorkflow(t *testing.T, comp *compositionsvc.CompositionService) composition.Workflow {
	t.Helper()
	nodes := []composition.Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "withSecret", NodeTypeID: "code-execution", Config: map[string]string{"envId": "with-secret-env"}},
		{ID: "noSecret", NodeTypeID: "code-execution", Config: map[string]string{"envId": "no-secret-env"}},
	}
	edges := []composition.Edge{
		{ID: "e1", Source: "t", Target: "withSecret"},
		{ID: "e2", Source: "withSecret", Target: "noSecret"},
	}
	wf, err := comp.CreateWorkflow("Secret attribute test workflow", "", nodes, edges)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	return wf
}

// fakeSecretLabels returns a fixed label set for withSecret's own
// config shape, nil (no secret use) for anything else -- realistic
// stand-in for configuresvc.DeriveSecretLabels' real behavior without
// this package depending on configuresvc (.claude/rules/backend.md).
func fakeSecretLabels(nodeTypeID string, config map[string]string) []string {
	if nodeTypeID == "code-execution" && config["envId"] == "with-secret-env" {
		return []string{"Demo secret"}
	}
	return nil
}

const secretsCondition = `len(Attributes["secrets"]) > 0`

func TestGuardrailStep_SecretsAttribute_AskRuleParksOnlyTheStepUsingASecret(t *testing.T) {
	g, comp := newTestGuardrailService(t)
	swapSecretLabelsLookup(t, fakeSecretLabels)
	wf := secretAttrWorkflow(t, comp)

	if _, err := g.CreateRule(guardrail.Rule{
		Label: "Uses a stored secret", Effect: guardrail.EffectAsk,
		NodeTypeID: "code-execution", Condition: secretsCondition,
	}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	withResult, err := g.TestRules(wf.ID, "withSecret")
	if err != nil {
		t.Fatalf("TestRules(withSecret): %v", err)
	}
	if withResult.Effect != string(guardrail.EffectAsk) || withResult.RuleLabel != "Uses a stored secret" {
		t.Errorf("TestRules(withSecret) = %+v, want ask/\"Uses a stored secret\"", withResult)
	}

	// noSecret is the SAME NodeType (code-execution, itself an
	// external-effect default-ask class) -- proving the rule's own
	// CONDITION, not its scope, is what distinguishes the two: this
	// step still asks (the effect-class default), but with NO rule
	// label, since the secrets condition evaluated false for it.
	noResult, err := g.TestRules(wf.ID, "noSecret")
	if err != nil {
		t.Fatalf("TestRules(noSecret): %v", err)
	}
	if noResult.Effect != string(guardrail.EffectAsk) || noResult.RuleLabel != "" {
		t.Errorf("TestRules(noSecret) = %+v, want ask/\"\" (effect-class default, rule did not match)", noResult)
	}
}

func TestGuardrailStep_SecretsAttribute_DenyRuleBlocksTheStepUsingASecret(t *testing.T) {
	g, comp := newTestGuardrailService(t)
	swapSecretLabelsLookup(t, fakeSecretLabels)
	wf := secretAttrWorkflow(t, comp)

	if _, err := g.CreateRule(guardrail.Rule{
		Label: "No secrets allowed here", Effect: guardrail.EffectDeny,
		NodeTypeID: "code-execution", Condition: secretsCondition,
	}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	result, err := g.TestRules(wf.ID, "withSecret")
	if err != nil {
		t.Fatalf("TestRules: %v", err)
	}
	if result.Effect != string(guardrail.EffectDeny) || result.RuleLabel != "No secrets allowed here" {
		t.Errorf("TestRules(withSecret) = %+v, want deny/\"No secrets allowed here\"", result)
	}
}

func TestGuardrailStep_SecretsAttribute_AllowRuleSkipsTheDefaultAsk(t *testing.T) {
	g, comp := newTestGuardrailService(t)
	swapSecretLabelsLookup(t, fakeSecretLabels)
	wf := secretAttrWorkflow(t, comp)

	if _, err := g.CreateRule(guardrail.Rule{
		Label: "Trusted secret use", Effect: guardrail.EffectAllow,
		NodeTypeID: "code-execution", Condition: secretsCondition,
	}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	result, err := g.TestRules(wf.ID, "withSecret")
	if err != nil {
		t.Fatalf("TestRules: %v", err)
	}
	if result.Effect != string(guardrail.EffectAllow) || result.RuleLabel != "Trusted secret use" {
		t.Errorf("TestRules(withSecret) = %+v, want allow/\"Trusted secret use\" (rule overrides the external-class ask default)", result)
	}
}

// TestGuardrailStep_SecretsAttribute_NeverMutatesSharedAttributes pins
// the "merged into a COPY" invariant GuardrailStep's own doc comment
// states: evaluating a step twice in a row (as WorkflowVerdicts does
// across every node of a workflow) must never leak one step's own
// "secrets" entry into a shared Attributes map read by another step.
func TestGuardrailStep_SecretsAttribute_NeverMutatesSharedAttributes(t *testing.T) {
	swapSecretLabelsLookup(t, fakeSecretLabels)
	shared := map[string]any{"existing": "value"}

	GuardrailStep("wf", composition.Node{ID: "n1", NodeTypeID: "code-execution", Config: map[string]string{"envId": "with-secret-env"}},
		composition.ExecContext{Attributes: shared})

	if _, ok := shared["secrets"]; ok {
		t.Error(`GuardrailStep wrote "secrets" into the caller's own Attributes map, want it left untouched`)
	}
	if len(shared) != 1 {
		t.Errorf("caller's Attributes map = %v, want only the original \"existing\" key", shared)
	}
}
