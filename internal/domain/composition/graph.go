package composition

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

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
		if n.Kind == KindTerminal && len(outgoingEdges[n.ID]) > 0 {
			return nil, nil, nil, fmt.Errorf("node %s: a terminal node (docs/adr/0027) may not have an outgoing edge", n.ID)
		}
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
// AttributesEnv builds the zero-value-seeded, override-applied
// Attributes environment a run starts from -- exported for the
// guardrail dry-run tester (guardrailservice.go), which must evaluate
// against the same environment shape the live gate sees.
func AttributesEnv(attrs []AttributeDef, values map[string]string) map[string]any {
	return attributesEnv(attrs, values)
}

// coerceAttrValue converts a reviewer-supplied string into the same Go
// type the attribute currently holds (docs/adr/0023's human-review
// input) -- mirroring attributesEnv's own per-type parsing so the
// test-input path and the review-input path can't drift.
func coerceAttrValue(current any, raw string) any {
	switch current.(type) {
	case float64:
		if n, err := strconv.ParseFloat(raw, 64); err == nil {
			return n
		}
		return current
	case bool:
		if b, err := strconv.ParseBool(raw); err == nil {
			return b
		}
		return current
	default:
		return raw
	}
}

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

// Severity classifies a validation Issue (docs/adr/0028): Error blocks
// save (ValidateGraphStrict rolls up only these); Warning never blocks
// anything -- it's purely informational for the editor's authoring-
// validation panel and MCP's validate_workflow. One severity contract
// everywhere: canvas save, UpdateWorkflow, and MCP update_workflow/
// validate_workflow all agree, per the ADR's own decision.
type Severity string

const (
	SeverityError   Severity = "error"
	SeverityWarning Severity = "warning"
)

// Issue is one problem ValidateGraph found. NodeID/EdgeID identify the
// offending node/edge when the issue is scoped to one -- both empty for
// a whole-graph issue (e.g. "no starting node," which names no single
// node/edge as the fix point). The editor's issues panel selects the
// referenced node/edge when a row is clicked; the per-node canvas
// badges group by NodeID the same way the guardrail badge already does
// (docs/adr/0022's Update).
type Issue struct {
	Severity Severity
	NodeID   string
	EdgeID   string
	Message  string
}

func errorIssue(nodeID, edgeID, msg string) Issue {
	return Issue{Severity: SeverityError, NodeID: nodeID, EdgeID: edgeID, Message: msg}
}

func warningIssue(nodeID, edgeID, msg string) Issue {
	return Issue{Severity: SeverityWarning, NodeID: nodeID, EdgeID: edgeID, Message: msg}
}

// ValidateGraph is the save-time half of "a save-time error and a
// run-time error never disagree" (composition.go's own established
// principle, first applied to the zod/Go validation-layer split, now
// extended to Decision): compiles every Decision node's non-otherwise
// edge against the workflow's declared Attributes schema, requires
// exactly one otherwiseHandle edge per Decision node, checks every node
// is reachable from the root, and (docs/adr/0028) returns the FULL list
// of everything wrong -- not just the first problem -- each labeled
// Error or Warning. ValidateGraphStrict below is the error-or-nil
// convenience form save paths use; ValidateGraph itself is what feeds
// the editor's authoring-validation panel and MCP's validate_workflow.
//
// Reachability replaces the old linearOrder's "every node visited"
// check, which no longer applies as-is: with branching, a single
// execution legitimately visits only one arm of a Decision, so "every
// node visited by walk()" would flag a working, correct branch as
// disconnected. This walks every outgoing edge (not just the one a real
// ExecContext would take) specifically to still catch a genuinely
// unreachable node -- one some Attributes value could never reach via
// any branch, not just the one this particular run happened to take.
//
// buildGraph's own structural checks (unknown edge references, a
// terminal node with an outgoing edge, a non-Decision node with more
// than one outgoing edge) stay fail-fast, single-issue: they describe a
// graph shape the canvas's own draw-time layer (isValidConnection)
// already prevents drawing in the first place, so a real user hits them
// only via an edge case (a hand-authored import, a stale drag) --
// unlike the rules below, which are real, expected mid-authoring states
// (a not-yet-configured step, a dangling leaf) worth surfacing
// alongside each other.
func ValidateGraph(nodes []Node, edges []Edge, attrs []AttributeDef) []Issue {
	byID, outgoingEdges, hasIncoming, err := buildGraph(nodes, edges)
	if err != nil {
		return []Issue{errorIssue("", "", err.Error())}
	}

	var issues []Issue

	root, rootErr := findRoot(nodes, hasIncoming)
	if rootErr != nil {
		issues = append(issues, errorIssue("", "", rootErr.Error()))
	} else {
		// docs/adr/0028's new rule: a workflow's single starting node
		// must be a Trigger -- a Trigger's output IS the workflow's
		// input, one concept (SPEC.md §3.4), not something any other
		// node kind can stand in for as the entry point.
		if n, ok := byID[root]; ok && n.Kind != KindTrigger {
			issues = append(issues, errorIssue(root, "", fmt.Sprintf("node %s: a workflow must start with a Trigger step", root)))
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
				issues = append(issues, errorIssue(n.ID, "", fmt.Sprintf("node %s is unreachable from the workflow's starting node", n.ID)))
			}
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
				issues = append(issues, errorIssue(n.ID, e.ID, fmt.Sprintf("decision node %s, edge %s: %v", n.ID, e.ID, err)))
			}
		}
		if otherwiseCount != 1 {
			issues = append(issues, errorIssue(n.ID, "", fmt.Sprintf("decision node %s must have exactly one \"otherwise\" edge, has %d", n.ID, otherwiseCount)))
		}
	}

	issues = append(issues, validateOutputBindingSecrets(nodes)...)
	issues = append(issues, validateLeaves(nodes, outgoingEdges)...)
	issues = append(issues, validateRequiredRefs(nodes)...)

	return issues
}

// ValidateGraphStrict rolls ValidateGraph's full issue list up into the
// error-or-nil form every save path needs (docs/adr/0028: errors block
// save, warnings never do). Joins EVERY Error-severity message -- not
// just the first -- into one summary line, since a save-rejection
// caller (the canvas's saveError banner, an MCP update_workflow
// rejection) has no other channel back to the full list than this
// returned error's own text.
func ValidateGraphStrict(nodes []Node, edges []Edge, attrs []AttributeDef) error {
	var msgs []string
	for _, issue := range ValidateGraph(nodes, edges, attrs) {
		if issue.Severity == SeverityError {
			msgs = append(msgs, issue.Message)
		}
	}
	switch len(msgs) {
	case 0:
		return nil
	case 1:
		return errors.New(msgs[0])
	default:
		return fmt.Errorf("%d problems: %s", len(msgs), strings.Join(msgs, "; "))
	}
}

// validateLeaves is docs/adr/0028's ending-model warning: a Capture or
// Process node with no outgoing edge computed something and delivered
// it nowhere -- legal to save (fine for a test run), but flagged.
// KindApply is deliberately exempt (an Apply ending is a real,
// legitimate ending -- ADR-0028 rejected "unify Apply into terminal" as
// removing real capability), and so is KindTerminal (the only
// structurally terminal kind, ADR-0027) since it's neither Capture nor
// Process to begin with.
func validateLeaves(nodes []Node, outgoingEdges map[string][]Edge) []Issue {
	var issues []Issue
	for _, n := range nodes {
		if n.Kind != KindCapture && n.Kind != KindProcess {
			continue
		}
		if len(outgoingEdges[n.ID]) > 0 {
			continue
		}
		issues = append(issues, warningIssue(n.ID, "",
			fmt.Sprintf("node %s: this step's result isn't delivered anywhere -- fine for a test run; add an Apply or Decision step to act on it", n.ID)))
	}
	return issues
}

// validateRequiredRefs is docs/adr/0028's other new warning: a node
// whose ConfigField declares a Configure-entity reference (RefKind --
// requestId/listId/mcpServerId/workflowId/decisionId, docs/adr/0009)
// but hasn't picked one yet. A warning, not an error: blocking would
// forbid saving a work-in-progress draft, but the step genuinely will
// fail the moment it actually runs.
func validateRequiredRefs(nodes []Node) []Issue {
	var issues []Issue
	for _, n := range nodes {
		nt, ok := nodeType(n.NodeTypeID)
		if !ok {
			continue
		}
		for _, field := range nt.ConfigFields {
			if field.RefKind == "" {
				continue
			}
			if strings.TrimSpace(n.Config[field.Key]) != "" {
				continue
			}
			issues = append(issues, warningIssue(n.ID, "",
				fmt.Sprintf("node %s: %s isn't set -- this step isn't configured yet and will fail at run time", n.ID, field.Label)))
		}
	}
	return issues
}

// validateOutputBindingSecrets is ADR-0007 Phase 3's secret guardrail:
// an integration-http node may not write a secret-classified response
// field (openapispec.Field.Secret -- format:"password", or a name
// that looks secret-shaped) into a workflow Attribute, since Attributes
// are plain, DBOS-checkpointed values (persisted to SQLite in plaintext,
// §7) with no secret-handling of their own. Lenient about anything it
// can't resolve (unknown request, unparseable spec, no matching
// operation) -- those are separate, pre-existing failure modes with
// their own error paths; this check only ever adds an issue on top of a
// graph that would otherwise be accepted, never papers over an
// unrelated problem.
func validateOutputBindingSecrets(nodes []Node) []Issue {
	var issues []Issue
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
			if f.Secret {
				secretFields[f.Key] = true
			}
		}
		for fieldName, attrName := range bindings {
			if secretFields[fieldName] {
				issues = append(issues, errorIssue(n.ID, "", fmt.Sprintf("node %s: field %q is a secret field and cannot be written to Attribute %q", n.ID, fieldName, attrName)))
			}
		}
	}
	return issues
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
