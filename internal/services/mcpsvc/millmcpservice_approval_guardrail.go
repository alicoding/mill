package mcpsvc

// The rule-plane half of the park-and-poll approval lifecycle
// (millmcpservice_approval.go): a gated write is judged against the
// shared guardrail rule-evaluation core before it ever reaches the
// durable park (docs/adr/0047 §5.4) -- split out once the lifecycle file
// crossed the 500-line limit (CLAUDE.md/§1.3), same "split along a real
// seam" discipline millmcpservice_approval_query.go already established.
//
// The durable park itself stays this package's own MCPWriteRecord, not
// guardrailsvc's in-memory PendingGuardedAction: unifying the park too
// would need PendingGuardedAction to gain durable persistence and an
// apply-on-approve payload, which several existing tests in this
// package (constructed with no guardrail dependency at all, asserting
// directly on this package's own store-persistence failure paths)
// assume it never does -- tracked as a follow-up, not folded into this
// slice.

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// mcpWriteGuardrailKind is the guardrail Kind a gated write is judged
// under (docs/adr/0047 §5.4) -- fills guardrail.Step.NodeTypeID via
// EvaluateAction, the same scope axis a workflow node's own NodeTypeID
// already targets, so a rule authored through the ordinary Guardrail
// CRUD governs every gated write tool uniformly, never a parallel rule
// vocabulary.
const mcpWriteGuardrailKind = "mcp-write"

// evaluateWriteVerdict judges one gated write against the shared
// guardrail rule-evaluation core (docs/adr/0047 §5.4's "one entry, one
// rule plane") -- the exact EvaluateStep/EvaluateAction core
// RequestGuardedAction and the workflow execution gate already share, so
// a rule created via the normal Configure > Guardrail CRUD applies to
// MCP writes too. m.guard is nil in every test that never calls
// SetGuardrailService; the fail-safe there is the same one
// guardrail.ClassExternal's own DefaultEffect already returns for "no
// rule matched" -- ask, i.e. always park, exactly gateWrite's pre-rebase
// behavior.
func (m *MillMCPService) evaluateWriteVerdict(toolName, description string) guardrail.Verdict {
	if m.guard == nil {
		return guardrail.Verdict{Effect: guardrail.EffectAsk}
	}
	attrs := map[string]string{"toolName": toolName, "description": description}
	return m.guard.EvaluateAction(mcpWriteGuardrailKind, attrs, guardrail.ClassExternal)
}

// writeVerdictShortCircuit evaluates the write and, when the verdict is
// allow or deny, returns the FINAL result/error for gateWrite to hand
// back directly (handled=true) -- allow executes immediately, deny
// blocks with no park at all. handled=false means "ask" (no rule
// matched, or no guardrail service wired): gateWrite falls through to
// its existing durable park unchanged.
func (m *MillMCPService) writeVerdictShortCircuit(toolName, description, argsJSON string) (result *mcp.CallToolResult, err error, handled bool) {
	switch verdict := m.evaluateWriteVerdict(toolName, description); verdict.Effect {
	case guardrail.EffectDeny:
		reason := verdict.RuleLabel
		if reason == "" {
			reason = verdict.RuleID
		}
		return nil, fmt.Errorf("denied by guardrail rule %q", reason), true
	case guardrail.EffectAllow:
		text, execErr := m.execute(toolName, argsJSON)
		if execErr != nil {
			return nil, execErr, true
		}
		return textResult(text), nil, true
	}
	return nil, nil, false
}
