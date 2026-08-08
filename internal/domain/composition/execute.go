package composition

import (
	"fmt"
)

// StepRunner wraps one node's exec call so a durable caller (see
// internal/adapters/execution + executionservice.go) can checkpoint it
// -- e.g. via DBOS's RunAsStep, keyed by stepID -- without composition
// itself depending on DBOS (domain purity, CLAUDE.md's ports/adapters
// rule; docs/adr/0004's "Mill workflow/step mapping" update). stepID is
// the executing Node's own ID, so a durable caller can join DBOS's
// per-workflow step history back onto this graph by ID with no separate
// naming scheme to keep in sync.
type StepRunner func(stepID string, fn func() (ExecContext, error)) (ExecContext, error)

// directStepRunner is what ExecuteWorkflow uses -- calls fn immediately,
// no checkpointing. This is the only runner every existing caller/test
// has ever seen; ExecuteWorkflowWithStepRunner with a nil run behaves
// identically.
func directStepRunner(_ string, fn func() (ExecContext, error)) (ExecContext, error) {
	return fn()
}

// ExecuteWorkflow runs a fully-resolved node graph, following Decision
// nodes' conditional edges (walk/nextNode) instead of a flat ordered
// list. Errors here are plain/technical, not hand-tuned soft-failure
// copy (e.g. "no HTML found on the clipboard" with a nil error) -- a
// deliberate prototype simplification carried over from before Runbook's
// retirement, not yet revisited.
//
// attrs seeds ctx.Attributes via attributesEnv's zero-valued defaults --
// the same interim behavior ValidateGraph's own save-time type-checking
// already relies on. There is no manual-test-run UI yet to supply real
// values (SPEC.md §3.5's Attributes CRUD, still future work), so every
// Decision edge referencing a declared Attribute evaluates against its
// type's zero value until one exists; a workflow with no Attributes
// (both built-ins today) behaves exactly as before this parameter
// existed.
// attrValues is an optional (0 or 1 element) trailing override for the
// run's starting Attribute values -- docs/adr/0008's test-input form.
// Variadic rather than a plain parameter specifically so every existing
// caller (20+ in execute_test.go alone) keeps compiling unchanged;
// there is exactly one thing being added here, not a family of options,
// so a small options-pattern type would be more machinery than the
// problem warrants (.claude/rules/architecture.md's anti-proliferation
// bias).
func ExecuteWorkflow(nodes []Node, edges []Edge, attrs []AttributeDef, attrValues ...map[string]string) (string, error) {
	return executeWorkflow(nodes, edges, attrs, directStepRunner, firstValues(attrValues))
}

// ExecuteWorkflowWithStepRunner is ExecuteWorkflow with each node's exec
// call routed through run instead of called directly -- the seam
// executionservice.go uses to checkpoint every node as a durable DBOS
// step. A nil run behaves exactly like ExecuteWorkflow.
func ExecuteWorkflowWithStepRunner(nodes []Node, edges []Edge, attrs []AttributeDef, run StepRunner, attrValues ...map[string]string) (string, error) {
	if run == nil {
		run = directStepRunner
	}
	return executeWorkflow(nodes, edges, attrs, run, firstValues(attrValues))
}

func firstValues(vs []map[string]string) map[string]string {
	if len(vs) == 0 {
		return nil
	}
	return vs[0]
}

func executeWorkflow(nodes []Node, edges []Edge, attrs []AttributeDef, run StepRunner, attrValues map[string]string) (string, error) {
	if len(nodes) == 0 {
		return "", fmt.Errorf("a workflow needs at least one node")
	}

	byID, outgoingEdges, hasIncoming, err := buildGraph(nodes, edges)
	if err != nil {
		return "", err
	}
	root, err := findRoot(nodes, hasIncoming)
	if err != nil {
		return "", err
	}

	ctx := ExecContext{Attributes: attributesEnv(attrs, attrValues)}
	visited := make(map[string]bool, len(nodes))
	current := root
	for {
		if visited[current] {
			return "", fmt.Errorf("workflow graph contains a cycle")
		}
		visited[current] = true

		node := byID[current]
		// Trigger and Decision nodes carry no payload transformation --
		// Trigger marks the entry point, Decision is a pure routing
		// point whose only job is picking the next edge (nextNode,
		// below); both register with exec: nil by design (see each
		// node type's own registration comment, e.g. decision.go).
		if node.Kind != KindTrigger && node.Kind != KindDecision {
			entry, ok := nodeTypeRegistry[node.NodeTypeID]
			if !ok || entry.exec == nil {
				return "", fmt.Errorf("unknown node type: %s", node.NodeTypeID)
			}
			ctx, err = run(node.ID, func() (ExecContext, error) { return entry.exec(node, ctx) })
			if err != nil {
				return "", fmt.Errorf("node %s: %w", node.NodeTypeID, err)
			}
		}

		next, err := nextNode(node, outgoingEdges[node.ID], ctx)
		if err != nil {
			return "", err
		}
		if next == "" {
			break
		}
		current = next
	}

	return ctx.Payload, nil
}
