package guardrailsvc

import (
	"context"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/google/uuid"
)

// One rule-evaluation core, two entry points (docs/adr/0047 §5): every
// verdict -- whether for an about-to-execute workflow step or a
// non-workflow GuardedAction -- is decided by guardrail.Evaluate over
// the SAME rule set (EvaluateStep below). The execution gate
// (executionsvc.evaluateVerdict) and RequestGuardedAction are its two
// callers; neither one owns a second, parallel policy plane.

// EvaluateStep is the guardrail's rule-evaluation core: judges a
// fully-formed Step against the current rules with guardrail.Evaluate's
// deny > ask > allow > class-default precedence. A thin wrapper by
// design -- the extraction this pays for is a single call site every
// caller (a workflow step, a generic action) shares, so they can never
// silently diverge into two different evaluations of the same rules.
func (g *GuardrailService) EvaluateStep(step guardrail.Step, class guardrail.EffectClass) guardrail.Verdict {
	return guardrail.Evaluate(g.Rules(), step, class)
}

// EvaluateAction adapts a generic action's kind/attributes into a Step
// and evaluates it through EvaluateStep. kind fills Step.NodeTypeID --
// the same scope axis a workflow node's own NodeTypeID already targets
// -- so a rule authored against a NodeTypeID scope also targets a
// guarded action of that kind, by construction, with no separate rule
// vocabulary to maintain.
func (g *GuardrailService) EvaluateAction(kind string, attributes map[string]string, class guardrail.EffectClass) guardrail.Verdict {
	attrs := make(map[string]any, len(attributes))
	for k, v := range attributes {
		attrs[k] = v
	}
	step := guardrail.Step{
		NodeTypeID: kind,
		Env:        guardrail.ConditionEnv("", attrs, nil),
	}
	return g.EvaluateStep(step, class)
}

// guardedActionTimeout is the same §8 fail-safe every other park in
// this codebase already resolves an unattended ask to
// (guardrailApprovalTimeout in executionsvc, mcpWriteExpiry in
// mcpsvc) -- an unresolved guarded action denies itself closed after a
// day rather than blocking its caller forever.
const guardedActionTimeout = 24 * time.Hour

// GuardedAction is what a non-workflow caller -- an agent today, a
// plugin once the out-of-tree loader ships (docs/adr/0047 §5) -- asks
// the guardrail to judge. Attributes is evaluated by the exact same
// rule conditions (guardrail.ConditionEnv) a workflow step's own
// Attributes already are.
type GuardedAction struct {
	// Kind names the action class for rule targeting (fills
	// Step.NodeTypeID -- see EvaluateAction).
	Kind string
	// Attributes is the same map[string]string vocabulary a workflow
	// step's rules already evaluate.
	Attributes map[string]string
	// Description feeds the approval UI (Review, the floating prompt).
	Description string
	// Source names who's asking (an agent id, a future plugin id) --
	// carried onto the parked PendingGuardedAction's own Source field.
	Source string
}

// Decision is RequestGuardedAction's outcome. Approved is what every
// caller branches on; Effect/RuleID/RuleLabel identify what decided it
// (the original verdict, even after a human resolves an ask -- Effect
// stays "ask", Approved carries the human's actual answer).
type Decision struct {
	Approved  bool
	Effect    guardrail.Effect
	RuleID    string
	RuleLabel string
}

// PendingGuardedAction is a parked, not-yet-resolved GuardedAction --
// the non-workflow analogue of executionsvc.PendingApproval (docs/adr/0047
// §5 point 3): additive, never reshaping the workflow park it is meant
// to one day render alongside.
type PendingGuardedAction struct {
	ID          string
	Kind        string
	Attributes  map[string]string
	Description string
	Source      string
	CreatedAt   time.Time
}

// guardedActionRecord is one parked action's live bookkeeping --
// decision is unexported so it never round-trips through anything that
// marshals PendingGuardedAction.
type guardedActionRecord struct {
	PendingGuardedAction
	decision chan bool
}

// RequestGuardedAction is the guardrail's public "submit an action for
// evaluation" entry (docs/adr/0047 §5) -- the second caller of the
// rule-evaluation core EvaluateStep/EvaluateAction above already share
// with the execution gate. allow/deny resolve immediately; ask parks a
// PendingGuardedAction and blocks until a human resolves it
// (resolveGuardedAction), ctx is cancelled (a clean withdrawal -- the
// pending record is removed either way, never left orphaned), or the
// same 24h fail-safe every other park in this codebase already uses
// elapses.
//
// class is always guardrail.ClassExternal: a guarded action is by
// definition a request for a primitive the caller does not hold
// directly (docs/adr/0047 §2), which is exactly what ClassExternal's
// ask-by-default fail-safe already gates without a rule naming it.
//
// Not Wails-bound this slice -- a Go-internal entry for future
// in-process consumers; binding it is deferred until a real caller
// needs it from the frontend.
//
//wails:ignore
func (g *GuardrailService) RequestGuardedAction(ctx context.Context, action GuardedAction) (Decision, error) {
	verdict := g.EvaluateAction(action.Kind, action.Attributes, guardrail.ClassExternal)
	switch verdict.Effect {
	case guardrail.EffectAllow:
		return Decision{Approved: true, Effect: verdict.Effect, RuleID: verdict.RuleID, RuleLabel: verdict.RuleLabel}, nil
	case guardrail.EffectDeny:
		return Decision{Approved: false, Effect: verdict.Effect, RuleID: verdict.RuleID, RuleLabel: verdict.RuleLabel}, nil
	}

	rec := &guardedActionRecord{
		PendingGuardedAction: PendingGuardedAction{
			ID:          uuid.NewString(),
			Kind:        action.Kind,
			Attributes:  action.Attributes,
			Description: action.Description,
			Source:      action.Source,
			CreatedAt:   time.Now(),
		},
		decision: make(chan bool, 1),
	}
	g.parkGuardedAction(rec)
	defer g.unparkGuardedAction(rec.ID)

	select {
	case approve := <-rec.decision:
		return Decision{Approved: approve, Effect: verdict.Effect, RuleID: verdict.RuleID, RuleLabel: verdict.RuleLabel}, nil
	case <-ctx.Done():
		return Decision{}, ctx.Err()
	case <-time.After(guardedActionTimeout):
		return Decision{Approved: false}, fmt.Errorf("guardrail: guarded action approval timed out after %s", guardedActionTimeout)
	}
}

// parkGuardedAction/unparkGuardedAction/resolveGuardedAction/
// pendingGuardedActions are the in-process pending store: an in-memory
// map, not settings-persisted (unlike mcpsvc's MCPWriteRecord) --
// RequestGuardedAction has no real caller yet in this slice (the MCP
// rebase is next), so there is nothing whose restart-survival matters
// today; the record shape (PendingGuardedAction) carries everything a
// future durable store would need to persist.

func (g *GuardrailService) parkGuardedAction(rec *guardedActionRecord) {
	g.guardedActionsMu.Lock()
	defer g.guardedActionsMu.Unlock()
	if g.guardedActions == nil {
		g.guardedActions = map[string]*guardedActionRecord{}
	}
	g.guardedActions[rec.ID] = rec
}

func (g *GuardrailService) unparkGuardedAction(id string) {
	g.guardedActionsMu.Lock()
	defer g.guardedActionsMu.Unlock()
	delete(g.guardedActions, id)
}

// resolveGuardedAction delivers a human decision to a parked action --
// the Go-internal analogue of executionsvc.ResolveApproval. Returns
// false when id names no currently-parked action (already resolved,
// timed out, or never existed), mirroring ResolveApproval's own
// unknown-id error path at the caller's discretion.
func (g *GuardrailService) resolveGuardedAction(id string, approve bool) bool {
	g.guardedActionsMu.Lock()
	rec, ok := g.guardedActions[id]
	g.guardedActionsMu.Unlock()
	if !ok {
		return false
	}
	select {
	case rec.decision <- approve:
	default:
	}
	return true
}

// pendingGuardedActions lists every currently-parked action -- the
// listing half of the pending model a future Review/floating-prompt
// wiring (or the MCP rebase) will read from.
func (g *GuardrailService) pendingGuardedActions() []PendingGuardedAction {
	g.guardedActionsMu.Lock()
	defer g.guardedActionsMu.Unlock()
	out := make([]PendingGuardedAction, 0, len(g.guardedActions))
	for _, rec := range g.guardedActions {
		out = append(out, rec.PendingGuardedAction)
	}
	return out
}
