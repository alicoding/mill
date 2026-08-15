package composition

import (
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/domain/guardrail"
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

// ExecuteOptions bundles ExecuteWorkflow's optional inputs. Started as a
// single ad-hoc variadic map (docs/adr/0008's test-input form); folded
// into a struct once docs/adr/0010's RunContext became a second,
// differently-typed optional value -- Go allows only one variadic
// parameter, so two independent options no longer fit that shape. Still
// passed variadically (0 or 1 ExecuteOptions) so a caller supplying
// neither keeps compiling unchanged.
type ExecuteOptions struct {
	// AttrValues overrides the run's starting Attribute values --
	// docs/adr/0008's test-input form.
	AttrValues map[string]string
	// RunContext is threaded straight into the root ExecContext's own
	// RunContext field -- see that field's doc comment (types.go).
	RunContext any
	// WorkflowID identifies which workflow definition this run executes
	// -- the guardrail gate needs it to match workflow/instance-scoped
	// rules (docs/adr/0019). Empty (direct ExecuteWorkflow calls, unit
	// tests) simply means no workflow-scoped rule can match.
	WorkflowID string
	// InitialPayload seeds the root ExecContext's Payload instead of the
	// usual empty string -- a headless trigger fire's own event data
	// (e.g. a filesystem-watch trigger's changed file path,
	// docs/SPEC.md §3.4's Trigger row: "a trigger's output IS the
	// workflow's input"). Empty (every caller before this field existed,
	// a manual/hotkey/schedule/clipboard-watch fire today) means exactly
	// today's behavior -- a run starting from "".
	InitialPayload string
	// Stepped seeds the root ExecContext.Stepped -- see that field's own
	// doc comment (types.go). False (every caller before this field
	// existed) means exactly today's behavior.
	Stepped bool
}

// GuardrailGate is the injected approval seam (docs/adr/0022): called
// before every non-trigger/non-decision node executes; a non-nil error
// aborts the run. The implementation lives in executionservice.go (the
// only place holding the durable-execution context) -- same injected-
// function pattern as SetHTTPRequestLookup, per CLAUDE.md's backend
// rule. runCtx is the run's opaque RunContext (a DBOS context for a
// durable run, nil for a direct in-memory execution).
//
// Returns the (possibly modified) ExecContext, not just an error
// (docs/adr/0031 item 4/5): a breakpoint/step-mode park can apply an
// edited Attribute value before the node runs, or clear Stepped on an
// explicit Continue -- the gate is the only place that can carry such a
// change back into the run, since a node's own exec function never sees
// the pre-park ctx separately from its own transformation of it.
type GuardrailGate func(runCtx any, workflowID string, node Node, ec ExecContext) (ExecContext, error)

var guardrailGate GuardrailGate

// SetGuardrailGate installs the gate. A nil gate (the default, and
// every composition unit test) means no gating -- the domain package
// stays executable standalone.
func SetGuardrailGate(g GuardrailGate) { guardrailGate = g }

// NodeTypeEffect reports a node type's declared side-effect class
// (docs/adr/0022's purity model); unknown IDs and undeclared types are
// ClassNone. Resolves through lookupNodeTypeEntry (declaredsteptype.go)
// so a declared step type reports its underlying engine's Effect
// verbatim -- ADR-0037: a declaration can never weaken gating.
func NodeTypeEffect(nodeTypeID string) guardrail.EffectClass {
	entry, ok := lookupNodeTypeEntry(nodeTypeID)
	if !ok || entry.nodeType.Effect == "" {
		return guardrail.ClassNone
	}
	return entry.nodeType.Effect
}

func firstOptions(opts []ExecuteOptions) ExecuteOptions {
	if len(opts) == 0 {
		return ExecuteOptions{}
	}
	return opts[0]
}

// ExecuteWorkflow runs a fully-resolved node graph, following Decision
// nodes' conditional edges (walk/nextNode) instead of a flat ordered
// list. Errors here are plain/technical, not hand-tuned soft-failure
// copy (e.g. "no HTML found on the clipboard" with a nil error) -- a
// deliberate prototype simplification carried over from before Runbook's
// retirement, not yet revisited.
//
// attrs seeds ctx.Attributes via attributesEnv's zero-valued defaults,
// overridden by opts.AttrValues where supplied (docs/adr/0008).
func ExecuteWorkflow(nodes []Node, edges []Edge, attrs []AttributeDef, opts ...ExecuteOptions) (string, error) {
	return executeWorkflow(nodes, edges, attrs, directStepRunner, firstOptions(opts))
}

// ExecuteWorkflowWithStepRunner is ExecuteWorkflow with each node's exec
// call routed through run instead of called directly -- the seam
// executionservice.go uses to checkpoint every node as a durable DBOS
// step. A nil run behaves exactly like ExecuteWorkflow.
func ExecuteWorkflowWithStepRunner(nodes []Node, edges []Edge, attrs []AttributeDef, run StepRunner, opts ...ExecuteOptions) (string, error) {
	if run == nil {
		run = directStepRunner
	}
	return executeWorkflow(nodes, edges, attrs, run, firstOptions(opts))
}

func executeWorkflow(nodes []Node, edges []Edge, attrs []AttributeDef, run StepRunner, opts ExecuteOptions) (string, error) {
	if len(nodes) == 0 {
		return "", fmt.Errorf("a workflow needs at least one step")
	}

	byID, outgoingEdges, hasIncoming, err := buildGraph(nodes, edges)
	if err != nil {
		return "", err
	}
	root, err := findRoot(nodes, outgoingEdges, hasIncoming)
	if err != nil {
		return "", err
	}

	ctx := ExecContext{Payload: opts.InitialPayload, Attributes: attributesEnv(attrs, opts.AttrValues), RunContext: opts.RunContext, Stepped: opts.Stepped}
	// visited records each node's position in path (traversal order) so
	// a cycle hit below can report the actual loop -- e.g. "b -> c -> b"
	// -- instead of a bare "contains a cycle" (goal 0021 gap 4: a
	// generic message left an authoring agent to find the loop by
	// process of elimination; a root-level cycle is already named by
	// findRoot/findAnyCycle above, this is the sibling case where the
	// graph has a valid single root but loops somewhere downstream of
	// it, which ValidateGraph's reachability check doesn't catch since
	// every node in the loop IS reachable from the root).
	visited := make(map[string]int, len(nodes))
	var path []string
	current := root
	for {
		if idx, ok := visited[current]; ok {
			cycle := append(append([]string{}, path[idx:]...), current)
			return "", fmt.Errorf("workflow graph contains a cycle: %s", strings.Join(cycle, " -> "))
		}
		visited[current] = len(path)
		path = append(path, current)

		node := byID[current]
		// Trigger and Decision nodes carry no payload transformation --
		// Trigger marks the entry point, Decision is a pure routing
		// point whose only job is picking the next edge (nextNode,
		// below); both register with exec: nil by design (see each
		// node type's own registration comment, e.g. decision.go).
		if node.Kind != KindTrigger && node.Kind != KindDecision {
			entry, ok := lookupNodeTypeEntry(node.NodeTypeID)
			if !ok || entry.exec == nil {
				return "", fmt.Errorf("unknown step type: %s", node.NodeTypeID)
			}
			// The guardrail gate runs before the node does (docs/adr/0022)
			// -- an ask verdict parks here durably, a deny aborts the run.
			// The gate may hand back a modified ctx (docs/adr/0031: an
			// edited Attribute value, or Stepped cleared by Continue).
			if guardrailGate != nil {
				gated, err := guardrailGate(opts.RunContext, opts.WorkflowID, node, ctx)
				if err != nil {
					return "", fmt.Errorf("step %s: %w", node.NodeTypeID, err)
				}
				ctx = gated
			}
			ctx, err = run(node.ID, func() (ExecContext, error) { return entry.exec(node, ctx) })
			if err != nil {
				return "", fmt.Errorf("step %s: %w", node.NodeTypeID, err)
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
