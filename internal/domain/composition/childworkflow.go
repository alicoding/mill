package composition

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// runChildWorkflowFn defaults to erroring so a child-workflow node run
// before ExecutionService wires SetChildWorkflowRunner (docs/adr/0010)
// fails loudly instead of silently no-op'ing -- same shape as
// lookupHTTPRequestFn/lookupListFn/lookupMCPServerFn's own defaults.
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
var runChildWorkflowFn = func(_ any, workflowID string, _ map[string]string, _ string, _ int) (string, error) {
	return "", fmt.Errorf("no child-workflow runner registered (yet) for workflow %q", workflowID)
}

// SetChildWorkflowRunner wires the function child-workflow nodes use to
// start another workflow as a real DBOS child run. Called once from
// main.go once ExecutionService exists.
func SetChildWorkflowRunner(fn func(runCtx any, workflowID string, attrValues map[string]string, idempotencyKey string, pinnedVersion int) (string, error)) {
	runChildWorkflowFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "child-workflow", Kind: KindProcess,
		Label: "Run another workflow",
		// Effect is explicitly ClassNone (never left at the zero value) --
		// docs/adr/0022: "Child workflows carry no class of their own
		// (none): the child's own steps are gated inside the child's own
		// run -- gating the invocation too would double-charge."
		Effect: guardrail.ClassNone,
		// Advanced: binding the child's typed input (inputBindings) needs
		// its declared Attributes schema, and idempotencyKey/bindings
		// accept "attr:<name>" expressions, not just plain values.
		Complexity:  ComplexityAdvanced,
		Consumes:    []PayloadKind{PayloadAny},
		Produces:    PayloadProduce{Kind: PayloadAny},
		Output:      "the child workflow's result",
		Description: "Runs another of your workflows as a step and uses its result as this workflow's payload. The other workflow must start with the \"Called by another workflow\" trigger.",
		ConfigFields: []ConfigField{
			{
				Key: "workflowId", Label: "Workflow",
				Description: "Which workflow to run. Only workflows whose trigger is \"callable by another workflow\" appear here. If the list is empty, create a workflow and drag that trigger onto its canvas first.",
				Default:     "", Type: FieldText, RefKind: "workflow",
			},
			{
				// Plain-language label -- "idempotency key" is DBOS's own
				// term (docs/adr/0010), too technical to lead with in UI
				// copy (reported directly from live use); the mechanism is
				// unchanged, only how it's explained.
				Key: "idempotencyKey", Label: "Skip duplicate runs (optional)",
				Description: "Leave empty to run fresh every time (the normal case). To make repeated runs with the same input reuse the first run's recorded result instead of running again, put a value here that identifies the input: a literal, or attr:<name> to use one of this workflow's attributes.",
				Default:     "", Type: FieldText,
			},
			{
				// ADR-0021's version pinning: empty follows the child's
				// published (live) version -- a moving pointer; a number
				// pins this step to that exact snapshot forever.
				Key: "version", Label: "Pin to version (optional)",
				Description: "Leave empty to always call the child's published version. Enter a version number to pin this step to that exact snapshot, unaffected by later publishes.",
				Default:     "", Type: FieldText,
			},
			{
				// The typed-output half of the parent/child contract: the
				// child's result always becomes this workflow's payload;
				// naming an attribute here ALSO stores it there, so a
				// downstream Decision/binding can use it as typed data,
				// not just as the flowing payload.
				Key: "outputAttribute", Label: "Store result in attribute (optional)",
				Description: "Also write the child workflow's result into this workflow's named Attribute, so later steps (a Decision condition, another binding) can reference it as attr:<name>.",
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
		pinnedVersion := 0
		if raw := strings.TrimSpace(node.Config["version"]); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 {
				return ctx, fmt.Errorf("child-workflow: version %q is not a positive version number", raw)
			}
			pinnedVersion = n
		}

		payload, err := runChildWorkflowFn(ctx.RunContext, node.Config["workflowId"], resolved, idempotencyKey, pinnedVersion)
		if err != nil {
			return ctx, fmt.Errorf("child-workflow: %w", err)
		}
		ctx.Payload = payload
		if outAttr := node.Config["outputAttribute"]; outAttr != "" {
			if ctx.Attributes == nil {
				ctx.Attributes = map[string]any{}
			}
			ctx.Attributes[outAttr] = payload
		}
		return ctx, nil
	})
}
