package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// The EXPLICIT half of Mill's two approval patterns (docs/adr/0022's
// Update, decided directly with the user: "we need both, and nothing
// should be hidden"). The ambient guardrail gate is policy -- evaluated
// around every effectful step, authored in Configure. This node is
// composition: a deliberate human checkpoint drawn visibly INTO the
// flow, the same shape as AWS Step Functions' waitForTaskToken
// human-approval pattern, Power Automate's "Start and wait for an
// approval" action, and n8n's Wait/Human-in-the-loop node. It always
// parks, regardless of any allow rule -- an allow rule skips the
// *policy* ask, never a checkpoint the author drew on purpose.

// waitForApprovalFn parks the run until a human approves -- wired by
// main.go to the same durable DBOS park the ambient gate uses
// (executionservice_guardrail.go), so both patterns share one pending/
// approve/deny surface. Same injected-seam shape as runChildWorkflowFn.
var waitForApprovalFn = func(runCtx any, node Node, ec ExecContext, message string) error {
	return fmt.Errorf("no approval waiter registered -- this run has no interactive context to ask in")
}

// SetApprovalWaiter wires the park mechanism. Called once from main.go
// once ExecutionService exists.
func SetApprovalWaiter(fn func(runCtx any, node Node, ec ExecContext, message string) error) {
	waitForApprovalFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "guardrail-wait-approval", Kind: KindProcess,
		Label:       "Wait for approval",
		Description: "Pauses the run here until you approve it from this workflow's Runs tab -- a deliberate, visible checkpoint in the flow. The payload passes through unchanged once approved; denying (or 24 hours of silence) stops the run. This is composition's half of the guardrail story: the ambient policy rules (Configure > Guardrails) decide when effectful steps ask on their own; this step asks because you drew it here, and no allow rule skips it.",
		Effect:      guardrail.ClassNone,
		ConfigFields: []ConfigField{
			{
				Key: "message", Label: "Message to the approver",
				Description: "Shown alongside the approval request, so future-you knows what this checkpoint is guarding.",
				Default:     "", Type: FieldText,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		if err := waitForApprovalFn(ctx.RunContext, node, ctx, node.Config["message"]); err != nil {
			return ExecContext{}, err
		}
		return ctx, nil
	})
}
