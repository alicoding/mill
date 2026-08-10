package executionsvc

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// The guardrail execution gate (docs/adr/0022): evaluation runs as a
// checkpointed step (rules load live from settings, so a crash-replay
// must reuse the recorded verdict, never re-evaluate against possibly-
// changed rules); an ask verdict parks the run durably on DBOS Recv --
// verified against the installed DBOS source to be exactly-once and to
// survive the process dying (§7's sharpened requirement) -- until
// ResolveApproval Sends the human's decision, or the timeout denies.

const (
	guardrailPendingEventKey = "guardrail-pending"
	guardrailApprovalTopic   = "guardrail-approval"
	// guardrailApprovalTimeout fails an unattended ask closed after a
	// day -- pending never silently becomes pass (§8 fail-safe). A
	// Settings knob is future work if a real need names one (ADR-0022).
	guardrailApprovalTimeout = 24 * time.Hour
)

// parseCSVKeys splits a comma-separated attribute-key list, trimming
// blanks -- the human-review node's input-subset config (goal 0001).
func parseCSVKeys(raw string) []string {
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if k := strings.TrimSpace(part); k != "" {
			out = append(out, k)
		}
	}
	return out
}

// PendingApproval is what a parked run advertises via SetEvent -- the
// §1 thesis applied to the guardrail itself: the human sees exactly
// which step wants to run, with which config, before it happens.
type PendingApproval struct {
	NodeID        string            `json:"nodeID"`
	NodeTypeID    string            `json:"nodeTypeID"`
	NodeTypeLabel string            `json:"nodeTypeLabel"`
	Config        map[string]string `json:"config"`
	Payload       string            `json:"payload"`
	RuleLabel     string            `json:"ruleLabel"`
	Resolved      bool              `json:"resolved"`
	Decision      string            `json:"decision"`
	// InputAttributes names which of the workflow's declared Attributes
	// the reviewer should fill for a human-review checkpoint (goal 0001);
	// empty means all. The Review queue renders only these.
	InputAttributes []string `json:"inputAttributes,omitempty"`
}

// GuardrailPendingChanged is a minimal park/resolve signal, Emitted
// alongside every SetEvent call below (goal 0005's research: three of
// four attention-transitions already push a Wails app.Event.Emit --
// mcp-write-approval, mill-data-changed, hotkey-activity -- this was
// the fourth, and the missing half of goal 0002's own deferred sidebar
// badge item). The payload is a POINTER, not a value to trust: DBOS's
// own SetEvent/pending-approval state stays the source of truth, every
// receiver refetches on receipt (the GitHub/macOS "a notification
// isn't the source of truth" precedent, recorded in
// docs/goals/0005-pending-attention-model.md).
type GuardrailPendingChanged struct {
	RunID    string `json:"runID"`
	NodeID   string `json:"nodeID"`
	Resolved bool   `json:"resolved"`
}

// emitGuardrailPendingChanged pushes GuardrailPendingChanged to the
// frontend. application.Get() is nil in a headless Go test process (no
// real Wails app was ever application.New()'d, same guard
// triggerservice.go's emitHotkeyActivity already uses) -- a no-op
// there, since there's no window to notify anyway.
func emitGuardrailPendingChanged(runID, nodeID string, resolved bool) {
	app := application.Get()
	if app == nil {
		return
	}
	app.Event.Emit("guardrail-pending-changed", GuardrailPendingChanged{
		RunID:    runID,
		NodeID:   nodeID,
		Resolved: resolved,
	})
}

type approvalDecision struct {
	NodeID  string
	Approve bool
	// Values is the reviewer's typed input (docs/adr/0023's human-review
	// node): overrides for the workflow's declared Attributes, applied
	// on resume. Empty for a plain approve and for ambient-gate asks.
	Values map[string]string
}

// guardrailGate is installed as composition.SetGuardrailGate at
// ExecutionService construction -- see docs/adr/0022 for the full flow.
func (e *ExecutionService) guardrailGate(runCtx any, workflowID string, node composition.Node, ec composition.ExecContext) error {
	// EffectForNode, not the static NodeTypeEffect: decision-outcome's
	// actual effect class depends on whether the Decision it references
	// carries a webhook (docs/adr/0027) -- every other NodeType's answer
	// is unchanged, since EffectForNode falls through to NodeTypeEffect
	// for everything else.
	class := composition.EffectForNode(node)

	ctx, ok := runCtx.(execution.Context)
	if !ok || ctx == nil {
		// No durable context (a direct composition.ExecuteWorkflow call
		// -- unit tests never install the gate, so in the app this is
		// unreachable per ADR-0008's single execution path). Fail safe
		// anyway: an ask with nowhere to ask is a deny, not a pass.
		v := guardrail.Evaluate(e.guard.Rules(), guardrailsvc.GuardrailStep(workflowID, node, ec), class)
		if v.Effect != guardrail.EffectAllow {
			return fmt.Errorf("guardrail: step requires approval but the run has no interactive context")
		}
		return nil
	}

	verdict, err := execution.RunAsStep(ctx, func(context.Context) (guardrail.Verdict, error) {
		return guardrail.Evaluate(e.guard.Rules(), guardrailsvc.GuardrailStep(workflowID, node, ec), class), nil
	}, execution.WithStepName("guardrail:"+node.ID))
	if err != nil {
		return fmt.Errorf("guardrail: evaluate: %w", err)
	}

	switch verdict.Effect {
	case guardrail.EffectAllow:
		return nil
	case guardrail.EffectDeny:
		if verdict.RuleLabel != "" {
			return fmt.Errorf("guardrail: denied by rule %q", verdict.RuleLabel)
		}
		return fmt.Errorf("guardrail: denied by rule %s", verdict.RuleID)
	}

	// Ask: park durably until a human decides (reviewer values are a
	// human-review-node concept -- the ambient gate ignores them).
	_, err = e.parkForApproval(ctx, node, ec, verdict.RuleLabel)
	return err
}

// parkForApproval advertises the pending step (SetEvent) and blocks on
// the durable Recv until ResolveApproval answers or the timeout denies.
// Shared by the ambient gate's ask verdict and the explicit
// "Wait for approval" node (composition.SetApprovalWaiter) -- both
// patterns, one pending/approve/deny surface (docs/adr/0022's Update).
func (e *ExecutionService) parkForApproval(ctx execution.Context, node composition.Node, ec composition.ExecContext, ruleLabel string) (map[string]string, error) {
	typeLabels := make(map[string]string)
	for _, nt := range composition.NodeTypes() {
		typeLabels[nt.ID] = nt.Label
	}
	pending := PendingApproval{
		NodeID:          node.ID,
		NodeTypeID:      node.NodeTypeID,
		NodeTypeLabel:   typeLabels[node.NodeTypeID],
		Config:          node.Config,
		Payload:         ec.Payload,
		RuleLabel:       ruleLabel,
		InputAttributes: parseCSVKeys(node.Config["inputAttributes"]),
	}
	runID, _ := ctx.GetWorkflowID()

	if err := execution.SetEvent(ctx, guardrailPendingEventKey, pending); err != nil {
		return nil, fmt.Errorf("guardrail: publish pending approval: %w", err)
	}
	emitGuardrailPendingChanged(runID, node.ID, false)

	decision, err := execution.Recv[approvalDecision](ctx, guardrailApprovalTopic, guardrailApprovalTimeout)
	if err != nil {
		return nil, fmt.Errorf("guardrail: await approval: %w", err)
	}

	pending.Resolved = true
	if decision.NodeID == "" {
		// Recv's timeout yields the zero value -- nobody answered.
		pending.Decision = "timed out"
		_ = execution.SetEvent(ctx, guardrailPendingEventKey, pending)
		emitGuardrailPendingChanged(runID, node.ID, true)
		return nil, fmt.Errorf("guardrail: approval timed out after %s", guardrailApprovalTimeout)
	}
	if !decision.Approve {
		pending.Decision = "denied"
		_ = execution.SetEvent(ctx, guardrailPendingEventKey, pending)
		emitGuardrailPendingChanged(runID, node.ID, true)
		return nil, fmt.Errorf("guardrail: denied by user")
	}
	pending.Decision = "approved"
	_ = execution.SetEvent(ctx, guardrailPendingEventKey, pending)
	emitGuardrailPendingChanged(runID, node.ID, true)
	return decision.Values, nil
}

// approvalWaiter backs the explicit "Wait for approval" node
// (composition.SetApprovalWaiter): always parks -- an allow rule skips
// the policy ask, never a checkpoint the author drew deliberately. The
// approver sees the node's configured message as the "rule" line.
func (e *ExecutionService) approvalWaiter(runCtx any, node composition.Node, ec composition.ExecContext, message string) (map[string]string, error) {
	ctx, ok := runCtx.(execution.Context)
	if !ok || ctx == nil {
		return nil, fmt.Errorf("human-review: this run has no interactive context to ask in")
	}
	if message == "" {
		message = "human review checkpoint"
	}
	return e.parkForApproval(ctx, node, ec, message)
}

// ResolveApproval delivers the human's decision to a parked run -- the
// Approve/Deny buttons' RPC. values is the reviewer's typed input for
// a human-review checkpoint (nil/empty for a plain approve or an
// ambient-gate ask). Send works from outside a workflow (verified
// against the installed DBOS source).
func (e *ExecutionService) ResolveApproval(runID, nodeID string, approve bool, values map[string]string) error {
	return execution.Send(e.ctx, runID, approvalDecision{NodeID: nodeID, Approve: approve, Values: values}, guardrailApprovalTopic)
}

// pendingApprovalFor polls a run's advertised pending approval (zero
// timeout -- never blocks a list render). Returns nil when the run
// never asked, or the ask is already resolved.
func (e *ExecutionService) pendingApprovalFor(runID string) *PendingApproval {
	p, err := execution.GetEvent[PendingApproval](e.ctx, runID, guardrailPendingEventKey, 0)
	if err != nil || p.NodeID == "" || p.Resolved {
		return nil
	}
	return &p
}

// approvalResolutionFor reads a run's RESOLVED approval outcome
// ("approved"/"denied"/"timed out"), if it ever had one -- the Review
// queue's recently-resolved visibility (goal 0002): the same event the
// park wrote, read after resolution instead of before.
func (e *ExecutionService) approvalResolutionFor(runID string) string {
	p, err := execution.GetEvent[PendingApproval](e.ctx, runID, guardrailPendingEventKey, 0)
	if err != nil || p.NodeID == "" || !p.Resolved {
		return ""
	}
	return p.Decision
}

// mayRequireApproval pre-scans a graph for any step that could park
// awaiting approval (guardrail.MayAsk's conservatism) -- RunWorkflow
// blocks only when the answer is no, so a Run click never hangs on a
// 24h approval wait.
func (e *ExecutionService) mayRequireApproval(workflowID string, nodes []composition.Node) bool {
	rules := e.guard.Rules()
	for _, n := range nodes {
		if n.Kind == composition.KindTrigger || n.Kind == composition.KindDecision {
			continue
		}
		// A node that always parks regardless of policy (the human-review
		// checkpoint, ADR-0023; a manual-review-category decision-outcome
		// node, ADR-0027) -- no allow rule vouches either away.
		if composition.NodeAlwaysParks(n) {
			return true
		}
		step := guardrail.Step{
			NodeTypeID: n.NodeTypeID,
			RequestID:  n.Config["requestId"],
			WorkflowID: workflowID,
			NodeID:     n.ID,
		}
		if guardrail.MayAsk(rules, step, composition.EffectForNode(n)) {
			return true
		}
	}
	return false
}
