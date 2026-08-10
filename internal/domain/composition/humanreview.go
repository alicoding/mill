package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// Human-in-the-loop (docs/adr/0023, evolving docs/adr/0022's explicit
// checkpoint): the workflow pauses here for input from someone --
// case-management style, the item lands in the Review queue, a
// reviewer supplies a decision AND optionally typed input (values for
// the workflow's declared Attributes) and the run resumes. Same shape
// as AWS Step Functions' waitForTaskToken human-approval pattern,
// Power Automate's "Start and wait for an approval" action, and n8n's
// Wait/Human-in-the-loop node. It always parks, regardless of any
// allow rule -- an allow rule skips the *policy* ask (ADR-0022), never
// a checkpoint the author drew on purpose.

// waitForApprovalFn parks the run until a human approves -- wired by
// main.go to the same durable DBOS park the ambient gate uses
// (executionservice_guardrail.go), so both patterns share one pending/
// approve/deny surface. Same injected-seam shape as runChildWorkflowFn.
var waitForApprovalFn = func(runCtx any, node Node, ec ExecContext, message string) (map[string]string, error) {
	return nil, fmt.Errorf("no approval waiter registered -- this run has no interactive context to ask in")
}

// SetApprovalWaiter wires the park mechanism. Called once from main.go
// once ExecutionService exists.
func SetApprovalWaiter(fn func(runCtx any, node Node, ec ExecContext, message string) (map[string]string, error)) {
	waitForApprovalFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "human-review", Kind: KindProcess,
		Label:       "Human review",
		Output:      "payload unchanged, after approval",
		Description: "Pauses the run for a person: the item lands in the Review queue (and this workflow's Runs tab), where a reviewer can approve, deny, and fill in values for this workflow's declared Attributes -- their input flows into the resumed run. Denying (or 24 hours of silence) stops the run. A deliberate, visible checkpoint you drew into the flow -- the ambient guardrail rules (Configure > Guardrails) never skip it.",
		Effect:      guardrail.ClassNone,
		ConfigFields: []ConfigField{
			{
				Key: "message", Label: "Message to the approver",
				Description: "Shown alongside the approval request, so future-you knows what this checkpoint is guarding.",
				Default:     "", Type: FieldText,
			},
			{
				// Which declared Attributes the reviewer is asked to fill
				// (goal 0001 node maturity): the node used to request ALL
				// of the workflow's attributes, which was noise when the
				// step only needed one. Comma-separated keys; empty means
				// all, preserving the prior behavior for existing nodes.
				Key: "inputAttributes", Label: "Ask for these attributes",
				Description: "Comma-separated Attribute keys the reviewer should fill in. Leave empty to ask for all of the workflow's Attributes.",
				Default:     "", Type: FieldText,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		values, err := waitForApprovalFn(ctx.RunContext, node, ctx, node.Config["message"])
		if err != nil {
			return ExecContext{}, err
		}
		// The reviewer's typed input overrides the named Attributes --
		// same string-in, typed-out coercion the test-input form uses
		// (docs/adr/0008), reusing coerceAttrValue so the two paths
		// can't drift.
		for key, raw := range values {
			if current, ok := ctx.Attributes[key]; ok {
				ctx.Attributes[key] = coerceAttrValue(current, raw)
			}
		}
		return ctx, nil
	})
}
