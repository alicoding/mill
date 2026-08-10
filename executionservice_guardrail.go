package main

import (
	"context"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
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
}

type approvalDecision struct {
	NodeID  string
	Approve bool
}

// guardrailGate is installed as composition.SetGuardrailGate at
// ExecutionService construction -- see docs/adr/0022 for the full flow.
func (e *ExecutionService) guardrailGate(runCtx any, workflowID string, node composition.Node, ec composition.ExecContext) error {
	class := composition.NodeTypeEffect(node.NodeTypeID)

	ctx, ok := runCtx.(execution.Context)
	if !ok || ctx == nil {
		// No durable context (a direct composition.ExecuteWorkflow call
		// -- unit tests never install the gate, so in the app this is
		// unreachable per ADR-0008's single execution path). Fail safe
		// anyway: an ask with nowhere to ask is a deny, not a pass.
		v := guardrail.Evaluate(e.guard.Rules(), guardrailStep(workflowID, node, ec), class)
		if v.Effect != guardrail.EffectAllow {
			return fmt.Errorf("guardrail: step requires approval but the run has no interactive context")
		}
		return nil
	}

	verdict, err := execution.RunAsStep(ctx, func(context.Context) (guardrail.Verdict, error) {
		return guardrail.Evaluate(e.guard.Rules(), guardrailStep(workflowID, node, ec), class), nil
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

	// Ask: park durably until a human decides.
	return e.parkForApproval(ctx, node, ec, verdict.RuleLabel)
}

// parkForApproval advertises the pending step (SetEvent) and blocks on
// the durable Recv until ResolveApproval answers or the timeout denies.
// Shared by the ambient gate's ask verdict and the explicit
// "Wait for approval" node (composition.SetApprovalWaiter) -- both
// patterns, one pending/approve/deny surface (docs/adr/0022's Update).
func (e *ExecutionService) parkForApproval(ctx execution.Context, node composition.Node, ec composition.ExecContext, ruleLabel string) error {
	typeLabels := make(map[string]string)
	for _, nt := range composition.NodeTypes() {
		typeLabels[nt.ID] = nt.Label
	}
	pending := PendingApproval{
		NodeID:        node.ID,
		NodeTypeID:    node.NodeTypeID,
		NodeTypeLabel: typeLabels[node.NodeTypeID],
		Config:        node.Config,
		Payload:       ec.Payload,
		RuleLabel:     ruleLabel,
	}
	if err := execution.SetEvent(ctx, guardrailPendingEventKey, pending); err != nil {
		return fmt.Errorf("guardrail: publish pending approval: %w", err)
	}

	decision, err := execution.Recv[approvalDecision](ctx, guardrailApprovalTopic, guardrailApprovalTimeout)
	if err != nil {
		return fmt.Errorf("guardrail: await approval: %w", err)
	}

	pending.Resolved = true
	if decision.NodeID == "" {
		// Recv's timeout yields the zero value -- nobody answered.
		pending.Decision = "timed out"
		_ = execution.SetEvent(ctx, guardrailPendingEventKey, pending)
		return fmt.Errorf("guardrail: approval timed out after %s", guardrailApprovalTimeout)
	}
	if !decision.Approve {
		pending.Decision = "denied"
		_ = execution.SetEvent(ctx, guardrailPendingEventKey, pending)
		return fmt.Errorf("guardrail: denied by user")
	}
	pending.Decision = "approved"
	_ = execution.SetEvent(ctx, guardrailPendingEventKey, pending)
	return nil
}

// approvalWaiter backs the explicit "Wait for approval" node
// (composition.SetApprovalWaiter): always parks -- an allow rule skips
// the policy ask, never a checkpoint the author drew deliberately. The
// approver sees the node's configured message as the "rule" line.
func (e *ExecutionService) approvalWaiter(runCtx any, node composition.Node, ec composition.ExecContext, message string) error {
	ctx, ok := runCtx.(execution.Context)
	if !ok || ctx == nil {
		return fmt.Errorf("wait-for-approval: this run has no interactive context to ask in")
	}
	if message == "" {
		message = "explicit checkpoint in this workflow"
	}
	return e.parkForApproval(ctx, node, ec, message)
}

// ResolveApproval delivers the human's decision to a parked run -- the
// Approve/Deny buttons' RPC. Send works from outside a workflow
// (verified against the installed DBOS source).
func (e *ExecutionService) ResolveApproval(runID, nodeID string, approve bool) error {
	return execution.Send(e.ctx, runID, approvalDecision{NodeID: nodeID, Approve: approve}, guardrailApprovalTopic)
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
		// The explicit Wait-for-approval node always parks -- it's a
		// drawn checkpoint, not policy, so no allow rule vouches it away.
		if n.NodeTypeID == "guardrail-wait-approval" {
			return true
		}
		step := guardrail.Step{
			NodeTypeID: n.NodeTypeID,
			RequestID:  n.Config["requestId"],
			WorkflowID: workflowID,
			NodeID:     n.ID,
		}
		if guardrail.MayAsk(rules, step, composition.NodeTypeEffect(n.NodeTypeID)) {
			return true
		}
	}
	return false
}
