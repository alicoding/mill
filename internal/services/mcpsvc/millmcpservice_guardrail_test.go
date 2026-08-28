package mcpsvc

// The new rules-leverage payoff (docs/adr/0047 §5.4): a guardrail rule
// authored through the ordinary Configure > Guardrail CRUD -- the exact
// same guardrailsvc.GuardrailService.CreateRule a human uses from the
// Review "Rules" audit view -- now governs a gated MCP write, because
// gateWrite's evaluateWriteVerdict judges it through EvaluateAction, the
// same rule-evaluation core the workflow execution gate and
// RequestGuardedAction already share (guardrailservice_request.go).

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// newGuardrailWiredHarness builds a MillMCPService with a real,
// store-backed GuardrailService wired via SetGuardrailService -- the
// main.go wiring this test proves matters, unlike every other harness in
// this package which leaves m.guard nil deliberately.
func newGuardrailWiredHarness(t *testing.T) (*MillMCPService, *guardrailsvc.GuardrailService, *compositionsvc.CompositionService) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	guard := guardrailsvc.NewGuardrailService(store, comp)

	m := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)
	m.SetGuardrailService(guard)
	if err := store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("set write key: %v", err)
	}
	// approval key left unset: required is the default -- a rule must be
	// what changes the outcome here, not a relaxed toggle.
	return m, guard, comp
}

// TestGateWrite_DenyRuleFromNormalCRUD_BlocksTheWriteWithNoPark proves a
// guardrail rule created through CreateRule (not a bespoke MCP-only
// concept) denies a gated write outright -- no park, no Activity/audit
// ceremony a plain policy deny never gets, and nothing written.
func TestGateWrite_DenyRuleFromNormalCRUD_BlocksTheWriteWithNoPark(t *testing.T) {
	m, guard, comp := newGuardrailWiredHarness(t)
	before := len(comp.Workflows())

	if _, err := guard.CreateRule(guardrail.Rule{
		Label: "Block all MCP writes", Effect: guardrail.EffectDeny, NodeTypeID: mcpWriteGuardrailKind,
	}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	res, err := m.gateWrite("import_workflow", "denied by rule", "{}")
	if err == nil {
		t.Fatalf("gateWrite() with a deny rule in place: want an error, got a result (res=%+v)", res)
	}
	if got := len(comp.Workflows()); got != before {
		t.Errorf("workflow count = %d, want %d -- a denied write must write nothing", got, before)
	}
	if pending := m.PendingMCPWrites(); len(pending) != 0 {
		t.Errorf("PendingMCPWrites() = %+v, want empty -- a deny-rule verdict must never park", pending)
	}
}

// TestGateWrite_AllowRuleFromNormalCRUD_SkipsTheParkAndExecutes proves
// the allow side of the same leverage: a matching allow rule executes
// the write immediately even though MCPWriteApprovalKey defaults to
// required, since the rule now short-circuits the ask-every-time
// default that governed every MCP write before this rebase.
func TestGateWrite_AllowRuleFromNormalCRUD_SkipsTheParkAndExecutes(t *testing.T) {
	m, guard, comp := newGuardrailWiredHarness(t)

	wf, err := comp.CreateWorkflow("Allow-rule source workflow", "",
		[]composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}, {ID: "c", NodeTypeID: "capture-clipboard-html"}},
		[]composition.Edge{{ID: "e1", Source: "t", Target: "c"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	exported, err := comp.ExportWorkflow(wf.ID)
	if err != nil {
		t.Fatalf("ExportWorkflow: %v", err)
	}
	before := len(comp.Workflows())

	if _, err := guard.CreateRule(guardrail.Rule{
		Label: "Allow all MCP writes", Effect: guardrail.EffectAllow, NodeTypeID: mcpWriteGuardrailKind,
	}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	argsJSON, err := marshalArgs(importToolArgs{JSON: stripJSONIDField(t, exported)})
	if err != nil {
		t.Fatalf("marshalArgs: %v", err)
	}
	res, err := m.gateWrite("import_workflow", "allowed by rule", argsJSON)
	if err != nil {
		t.Fatalf("gateWrite() with an allow rule in place: %v", err)
	}
	if res == nil || res.IsError {
		t.Fatalf("gateWrite() result = %+v, want a successful (non-error) result", res)
	}
	if got := len(comp.Workflows()); got != before+1 {
		t.Errorf("workflow count = %d, want %d -- an allow-rule verdict must execute immediately, no park needed", got, before+1)
	}
	if pending := m.PendingMCPWrites(); len(pending) != 0 {
		t.Errorf("PendingMCPWrites() = %+v, want empty -- an allow-rule verdict must never park", pending)
	}
}
