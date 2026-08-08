package composition

import (
	"fmt"
	"strconv"

	"github.com/alicoding/mill/internal/adapters/expression"
	"github.com/alicoding/mill/internal/adapters/openapispec"
)

// otherwiseHandle marks a Decision node's required fallback edge --
// taken when no other outgoing edge's condition matches.
const otherwiseHandle = "otherwise"

// buildGraph is shared setup for walk and ValidateDecisionEdges: index
// nodes by ID, group outgoing edges by source (preserving order -- a
// Decision node's non-otherwise edges are evaluated in that order, first
// match wins), and validate every edge references a real node.
func buildGraph(nodes []Node, edges []Edge) (byID map[string]Node, outgoingEdges map[string][]Edge, hasIncoming map[string]bool, err error) {
	byID = make(map[string]Node, len(nodes))
	for _, n := range nodes {
		byID[n.ID] = n
	}

	outgoingEdges = make(map[string][]Edge, len(nodes))
	hasIncoming = make(map[string]bool, len(edges))
	for _, e := range edges {
		if _, ok := byID[e.Source]; !ok {
			return nil, nil, nil, fmt.Errorf("edge references unknown source node: %s", e.Source)
		}
		if _, ok := byID[e.Target]; !ok {
			return nil, nil, nil, fmt.Errorf("edge references unknown target node: %s", e.Target)
		}
		outgoingEdges[e.Source] = append(outgoingEdges[e.Source], e)
		hasIncoming[e.Target] = true
	}

	for _, n := range nodes {
		if n.Kind != KindDecision && len(outgoingEdges[n.ID]) > 1 {
			return nil, nil, nil, fmt.Errorf("node %s: only a Decision node may have more than one outgoing edge", n.ID)
		}
	}

	return byID, outgoingEdges, hasIncoming, nil
}

// findRoot returns the single node with no incoming edge -- the
// workflow's entry point, same definition internal/domain/trigger's
// ExtractTrigger already relies on.
func findRoot(nodes []Node, hasIncoming map[string]bool) (string, error) {
	var root string
	rootCount := 0
	for _, n := range nodes {
		if !hasIncoming[n.ID] {
			root = n.ID
			rootCount++
		}
	}
	if rootCount != 1 {
		return "", fmt.Errorf("a workflow must have exactly one starting node")
	}
	return root, nil
}

// attributesEnv builds a realistic-zero-valued map[string]any from a
// workflow's Attributes schema -- used as expr.Compile's type-checking
// environment, so a Decision edge referencing a field with the wrong
// operator (e.g. comparing a text field with ">") is caught at save
// time, not just whenever that branch first actually runs.
// attributesEnv seeds the Attributes bag a run starts with. values is a
// caller-supplied override (docs/adr/0008's test-input form; nil for
// every other caller, e.g. ValidateGraph's save-time compile-check,
// which has no real values to offer and only needs the schema's shape)
// -- a value present and parseable for its declared Type wins, anything
// missing or unparseable falls back to the same zero value this always
// used, so a nil/empty values map behaves identically to before this
// parameter existed.
func attributesEnv(attrs []AttributeDef, values map[string]string) map[string]any {
	env := make(map[string]any, len(attrs))
	for _, a := range attrs {
		raw, has := values[a.Key]
		switch a.Type {
		case FieldNumber:
			if has {
				if n, err := strconv.ParseFloat(raw, 64); err == nil {
					env[a.Key] = n
					continue
				}
			}
			env[a.Key] = 0.0
		case FieldBoolean:
			if has {
				if b, err := strconv.ParseBool(raw); err == nil {
					env[a.Key] = b
					continue
				}
			}
			env[a.Key] = false
		default:
			if has {
				env[a.Key] = raw
				continue
			}
			env[a.Key] = ""
		}
	}
	return env
}

// ValidateGraph is the save-time half of "a save-time error and a
// run-time error never disagree" (composition.go's own established
// principle, first applied to the zod/Go validation-layer split, now
// extended to Decision): compiles every Decision node's non-otherwise
// edge against the workflow's declared Attributes schema, requires
// exactly one otherwiseHandle edge per Decision node, and checks every
// node is reachable from the root.
//
// Reachability replaces the old linearOrder's "every node visited"
// check, which no longer applies as-is: with branching, a single
// execution legitimately visits only one arm of a Decision, so "every
// node visited by walk()" would flag a working, correct branch as
// disconnected. This walks every outgoing edge (not just the one a real
// ExecContext would take) specifically to still catch a genuinely
// unreachable node -- one some Attributes value could never reach via
// any branch, not just the one this particular run happened to take.
func ValidateGraph(nodes []Node, edges []Edge, attrs []AttributeDef) error {
	_, outgoingEdges, hasIncoming, err := buildGraph(nodes, edges)
	if err != nil {
		return err
	}
	root, err := findRoot(nodes, hasIncoming)
	if err != nil {
		return err
	}

	reachable := map[string]bool{root: true}
	queue := []string{root}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		for _, e := range outgoingEdges[id] {
			if !reachable[e.Target] {
				reachable[e.Target] = true
				queue = append(queue, e.Target)
			}
		}
	}
	for _, n := range nodes {
		if !reachable[n.ID] {
			return fmt.Errorf("node %s is unreachable from the workflow's starting node", n.ID)
		}
	}

	env := attributesEnv(attrs, nil)

	for _, n := range nodes {
		if n.Kind != KindDecision {
			continue
		}
		outgoing := outgoingEdges[n.ID]
		otherwiseCount := 0
		for _, e := range outgoing {
			if e.SourceHandle == otherwiseHandle {
				otherwiseCount++
				continue
			}
			if err := expression.Compile(e.SourceHandle, env); err != nil {
				return fmt.Errorf("decision node %s, edge %s: %w", n.ID, e.ID, err)
			}
		}
		if otherwiseCount != 1 {
			return fmt.Errorf("decision node %s must have exactly one \"otherwise\" edge, has %d", n.ID, otherwiseCount)
		}
	}

	if err := validateOutputBindingSecrets(nodes); err != nil {
		return err
	}
	return nil
}

// validateOutputBindingSecrets is ADR-0007 Phase 3's secret guardrail:
// an integration-http node may not write a secret-classified response
// field (openapispec.Field.IsSecret -- format:"password", or a name
// that looks secret-shaped) into a workflow Attribute, since Attributes
// are plain, DBOS-checkpointed values (persisted to SQLite in plaintext,
// §7) with no secret-handling of their own. Lenient about anything it
// can't resolve (unknown request, unparseable spec, no matching
// operation) -- those are separate, pre-existing failure modes with
// their own error paths; this check only ever adds a rejection on top
// of a graph that would otherwise be accepted, never papers over an
// unrelated problem.
func validateOutputBindingSecrets(nodes []Node) error {
	for _, n := range nodes {
		if n.NodeTypeID != "integration-http" || n.Config["outputBindings"] == "" {
			continue
		}
		rc, err := lookupHTTPRequestFn(n.Config["requestId"])
		if err != nil || rc.OpenAPISpec == "" {
			continue
		}
		doc, err := openapispec.Parse([]byte(rc.OpenAPISpec))
		if err != nil {
			continue
		}
		op, err := doc.Operation(n.Config["path"], n.Config["method"])
		if err != nil {
			continue
		}
		bindings, err := parseBindings(n.Config["outputBindings"])
		if err != nil {
			continue
		}
		secretFields := make(map[string]bool, len(op.OutputFields))
		for _, f := range op.OutputFields {
			if f.IsSecret {
				secretFields[f.Name] = true
			}
		}
		for fieldName, attrName := range bindings {
			if secretFields[fieldName] {
				return fmt.Errorf("node %s: field %q is a secret field and cannot be written to Attribute %q", n.ID, fieldName, attrName)
			}
		}
	}
	return nil
}

// nextNode picks the one edge to follow from node, given its resolved
// outgoing edges and the current ExecContext. Every non-Decision node
// with an edge just follows it (buildGraph already guarantees at most
// one); a Decision node evaluates its non-otherwise edges in order,
// first true match wins, falling back to its otherwise edge. Returns ""
// (no error) for a terminal node with no outgoing edge at all.
func nextNode(node Node, outgoing []Edge, ctx ExecContext) (string, error) {
	if len(outgoing) == 0 {
		return "", nil
	}
	if node.Kind != KindDecision {
		return outgoing[0].Target, nil
	}

	var otherwise string
	for _, e := range outgoing {
		if e.SourceHandle == otherwiseHandle {
			otherwise = e.Target
			continue
		}
		matched, err := expression.Eval(e.SourceHandle, ctx.Attributes)
		if err != nil {
			return "", fmt.Errorf("decision edge %s: %w", e.ID, err)
		}
		if matched {
			return e.Target, nil
		}
	}
	if otherwise == "" {
		return "", fmt.Errorf("decision node %s has no otherwise edge", node.ID)
	}
	return otherwise, nil
}
