package composition

import (
	"fmt"
)

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
func ExecuteWorkflow(nodes []Node, edges []Edge, attrs []AttributeDef) (string, error) {
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

	ctx := ExecContext{Attributes: attributesEnv(attrs)}
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
			ctx, err = entry.exec(node, ctx)
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
