package composition

import "fmt"

// runChildWorkflowFn defaults to erroring so a child-workflow node run
// before ExecutionService wires SetChildWorkflowRunner (docs/adr/0010)
// fails loudly instead of silently no-op'ing -- same shape as
// lookupConnectorFn/lookupListFn/lookupMCPServerFn's own defaults.
//
// runCtx is ExecContext.RunContext, threaded through opaque -- this
// package never inspects it, only passes it along; the wired function
// (executionservice.go) type-asserts it back into a real DBOS
// execution.Context. attrValues are the child's already-resolved
// starting Attribute values (inputBindings resolved against the
// parent's own Attributes). idempotencyKey, if non-empty, becomes the
// child's DBOS workflow ID -- DBOS's own idempotency mechanism
// (WithWorkflowID): re-invoking with the same key returns the child's
// already-recorded result instead of re-running it. Empty means "a
// fresh run every time," the same default every other run gets.
var runChildWorkflowFn = func(runCtx any, workflowID string, attrValues map[string]string, idempotencyKey string) (string, error) {
	return "", fmt.Errorf("no child-workflow runner registered (yet) for workflow %q", workflowID)
}

// SetChildWorkflowRunner wires the function child-workflow nodes use to
// start another workflow as a real DBOS child run. Called once from
// main.go once ExecutionService exists.
func SetChildWorkflowRunner(fn func(runCtx any, workflowID string, attrValues map[string]string, idempotencyKey string) (string, error)) {
	runChildWorkflowFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "child-workflow", Kind: KindProcess,
		Label:       "Child workflow",
		Description: "Invokes another workflow (one rooted in trigger-callable, docs/adr/0010) as a real DBOS child run and replaces the payload with its result. Only meaningful on the durable execution path (docs/adr/0008 made that the only path) -- DBOS tracks the parent/child relationship natively once this call happens from inside an already-running workflow.",
		ConfigFields: []ConfigField{
			{
				Key: "workflowId", Label: "Workflow",
				Description: "A workflow rooted in trigger-callable.",
				Default:     "", Type: FieldText, RefKind: "workflow",
			},
			{
				Key: "idempotencyKey", Label: "Idempotency key (optional)",
				Description: "A literal or attr:<name> reference. If set, re-invoking with the same resolved key returns the child's already-recorded result instead of running it again (DBOS's own workflow-ID idempotency). Leave empty for a fresh run every time.",
				Default:     "", Type: FieldText,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		bindings, err := parseBindings(node.Config["inputBindings"])
		if err != nil {
			return ctx, fmt.Errorf("child-workflow: inputBindings: %w", err)
		}
		resolved := make(map[string]string, len(bindings))
		for k, raw := range bindings {
			resolved[k] = resolveBindingValue(raw, ctx.Attributes)
		}
		idempotencyKey := resolveBindingValue(node.Config["idempotencyKey"], ctx.Attributes)

		payload, err := runChildWorkflowFn(ctx.RunContext, node.Config["workflowId"], resolved, idempotencyKey)
		if err != nil {
			return ctx, fmt.Errorf("child-workflow: %w", err)
		}
		ctx.Payload = payload
		return ctx, nil
	})
}
