// Package composition is a prototype for SPEC.md §3 (capability
// composition), testing ADR-0005's node/workflow shape against real,
// working code rather than a mockup -- see docs/SPEC.md's `UX: PROTOTYPE`
// entry under §3. internal/domain/runbook (the original, separate
// Runbook page) has since been retired in favor of this package, per
// SPEC.md §2.2's Update note -- its two actions now live on as ordinary,
// fully-editable seeded workflows (BuiltInWorkflows below), the same
// real capability restated here, not a fictional example.
//
// Composing a workflow is inseparable from configuring it: a node is
// never just "a reference to a node type" -- it always carries fully
// resolved configuration values (see ResolveNodeDefaults), even when
// those values are just each field's default. There is no such thing as
// an unconfigured node.
//
// Workflow.Nodes + Workflow.Edges (rather than a flat ordered Step list)
// is the schema direction docs/SPEC.md §3.3 wrote down before this was
// built, matching React Flow's own {id, type, data, position} node shape
// -- adopted here as ADR-0005 B2's canvas deferral was explicitly
// overridden (see docs/adr/0005-capability-composition-node-schema.md's
// Update section) ahead of its original "2+ real multi-step workflows"
// trigger.
package composition

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"slices"

	"github.com/alicoding/mill/internal/adapters/clipboard"
	"github.com/alicoding/mill/internal/adapters/expression"
	"github.com/alicoding/mill/internal/adapters/markdown"
	"github.com/alicoding/mill/internal/domain/capabilities"
)

// Package-level function vars, not direct calls -- same testability
// pattern as internal/domain/runbook.
var (
	readClipboardHTML  = clipboard.ReadHTML
	writeClipboardHTML = clipboard.WriteHTML
	writeClipboardText = clipboard.WriteText
	htmlToMarkdown     = markdown.ToMarkdown
)

// NodeKind mirrors SPEC.md §2's Capture -> Process -> Apply primitive,
// plus Trigger (SPEC.md §3.4) and Decision (SPEC.md §3.5) -- Decision is
// the one kind allowed more than one outgoing edge (see walk/nextNode).
// Parallel/Child Workflow stay real future work, not stubbed here
// speculatively.
type NodeKind string

const (
	KindTrigger  NodeKind = "trigger"
	KindCapture  NodeKind = "capture"
	KindProcess  NodeKind = "process"
	KindApply    NodeKind = "apply"
	KindDecision NodeKind = "decision"
)

// ConfigFieldType is the field's UI/value shape -- modeled on n8n's own
// node-parameter taxonomy (docs.n8n.io, see docs/SPEC.md §3.4), narrowed
// to the subset Mill actually needs today. n8n's fuller set (collection,
// fixedCollection, resourceLocator, ...) maps to Mill's own not-yet-built
// Decision/Parallel nodes -- not stubbed here ahead of that need, same
// discipline as NodeKind's own comment above.
type ConfigFieldType string

const (
	FieldText    ConfigFieldType = "text"
	FieldNumber  ConfigFieldType = "number"
	FieldBoolean ConfigFieldType = "boolean"
	FieldOptions ConfigFieldType = "options"
)

// ConfigField declares one configurable parameter a node type's nodes
// can set. A node type with no ConfigFields takes no parameters --
// legitimately true for some nodes (capture/process here operate on
// whatever's piped in, every Trigger node type today), not a placeholder
// to fill in later.
type ConfigField struct {
	Key         string
	Label       string
	Description string
	Default     string
	Type        ConfigFieldType
	// Options is only meaningful when Type == FieldOptions -- the set of
	// values ResolveNodeDefaults will accept for this field.
	Options []string
}

type NodeType struct {
	ID           string
	Kind         NodeKind
	Label        string
	Description  string
	ConfigFields []ConfigField
}

// Position is a node's canvas coordinates. Ignored by execution entirely
// -- it exists purely for the React Flow canvas to restore a workflow's
// layout, matching React Flow's own node shape.
type Position struct {
	X float64
	Y float64
}

// Node is one configured instance of a node type inside a workflow's
// graph. Config is always fully resolved (every ConfigField's key
// present) by the time a Node is stored or executed -- see
// ResolveNodeDefaults. Kind is always derived server-side from
// NodeTypeID (never trusted from the client), so it can't drift out of
// sync with the node type it names.
type Node struct {
	ID         string
	Kind       NodeKind
	NodeTypeID string
	Config     map[string]string
	Position   Position
}

// Edge connects one Node's output to another's input by ID. SourceHandle
// is a Decision node's named branch: a real expr-lang/expr expression
// string (e.g. "Attributes.count > 5"), evaluated in order, first match
// wins; exactly one outgoing edge per Decision node must carry the
// literal otherwiseHandle value as the required fallback. Empty for
// every non-Decision edge, since no other node kind branches.
type Edge struct {
	ID           string
	Source       string
	SourceHandle string
	Target       string
}

// otherwiseHandle marks a Decision node's required fallback edge --
// taken when no other outgoing edge's condition matches.
const otherwiseHandle = "otherwise"

// AttributeDef declares one named, typed field in a workflow's
// structured Attributes bag (see ExecContext) -- Configure-authored
// (SPEC.md §3.5: "Input/Attributes... you would not tightly couple it in
// the workflow"), but scoped to the one workflow that declares it (1:1),
// unlike a reusable Connector or List. Reuses ConfigFieldType rather
// than inventing a second type enum -- a workflow's attribute schema and
// a node's config fields are the same kind of "name + typed value"
// declaration.
type AttributeDef struct {
	Key   string
	Label string
	Type  ConfigFieldType
}

// Workflow is a node/edge graph. Branching exists now (Decision nodes,
// see walk/nextNode) but is still constrained: every non-Decision node
// keeps at most one outgoing edge, so "graph" in practice means "a chain
// with Decision forks," not an arbitrary DAG.
type Workflow struct {
	ID          string
	Label       string
	Description string
	Nodes       []Node
	Edges       []Edge
	// Attributes is this workflow's declared structured-field schema --
	// what a Decision node's rule builder offers as available fields, and
	// what a generated test payload (§3.4) can seed. Does not itself
	// carry values; ExecContext.Attributes does, at run time.
	Attributes []AttributeDef
	// BuiltIn marks a seeded, non-deletable workflow (the two shipped
	// with this prototype) vs. one a user composed and that persisted --
	// the UI badges/protects built-ins accordingly.
	BuiltIn bool
}

// ExecContext threads through a workflow's execution. Payload is the
// existing single-string artifact every Capture/Process/Apply node
// already reads/writes, unchanged in shape; Attributes is new -- a
// separate, structured bag Decision rules evaluate against, populated by
// nodes that choose to write to it (e.g. a future list-lookup or
// integration-http node) rather than by restructuring Payload itself,
// which would have touched every existing node's logic for a need only
// Decision has today.
type ExecContext struct {
	Payload    string
	Attributes map[string]any
}

// sampleHTML is the default value for apply-clipboard-write-html's
// "html" field -- a demo fixture, not a fact anything else depends on.
const sampleHTML = `<h2>Quarterly update</h2>
<p>Here's a quick summary, with <strong>the important bit</strong> called out.</p>
<ul>
  <li>Runbook actions now support global keyboard shortcuts</li>
  <li>Clipboard capture preserves <em>real</em> structure, not flattened text</li>
  <li>The UI now runs on Primer, not hand-rolled CSS</li>
</ul>`

func NodeTypes() []NodeType {
	return []NodeType{
		// Trigger node types -- SPEC.md §3.4: each concrete event source
		// is its own NodeType under KindTrigger, matching how n8n/Zapier
		// actually structure this (separate, distinctly-named node types,
		// not one generic node with a Source dropdown). A workflow's root
		// is expected to be one of these; linearOrder's existing "exactly
		// one starting node" check already enforces that without needing
		// Trigger-specific logic. ExecuteWorkflow skips Trigger nodes at
		// run time -- they mark the entry point, they don't transform the
		// payload.
		{
			ID: "trigger-manual", Kind: KindTrigger,
			Label:       "Trigger: manual",
			Description: "Fires on-demand when a user clicks Run/Test. No listener process.",
		},
		{
			ID: "trigger-hotkey", Kind: KindTrigger,
			Label:       "Trigger: hotkey",
			Description: "Fires on a global keyboard shortcut, even when Mill isn't focused. Bound via TriggerService, not a config field here -- pressing the combo is better UX than typing it.",
		},
		{
			ID: "trigger-schedule", Kind: KindTrigger,
			Label:       "Trigger: schedule",
			Description: "Fires on a cron schedule.",
			ConfigFields: []ConfigField{
				{
					Key: "cron", Label: "Cron expression",
					Description: "Standard 5-field cron expression (minute hour day month weekday).",
					Default:     "", Type: FieldText,
				},
			},
		},
		{
			ID: "trigger-clipboard-watch", Kind: KindTrigger,
			Label:       "Trigger: clipboard change",
			Description: "Fires whenever the clipboard's content changes.",
		},
		{
			ID: "trigger-filesystem-watch", Kind: KindTrigger,
			Label:       "Trigger: filesystem change",
			Description: "Fires when a file or folder under the configured path is added, changed, or deleted.",
			ConfigFields: []ConfigField{
				{
					Key: "path", Label: "Path to watch",
					Description: "Absolute path to a file or directory.",
					Default:     "", Type: FieldText,
				},
			},
		},
		{
			ID: "capture-clipboard-html", Kind: KindCapture,
			Label:       "Capture: clipboard HTML",
			Description: "Reads whatever HTML is currently on the clipboard.",
		},
		{
			ID: "process-html-to-markdown", Kind: KindProcess,
			Label:       "Process: HTML → Markdown",
			Description: "Converts HTML into Markdown, preserving structure (headings, bold, lists).",
		},
		{
			ID: "apply-clipboard-write-text", Kind: KindApply,
			Label:       "Apply: write plain text to clipboard",
			Description: "Writes the workflow's current payload to the clipboard as plain text.",
		},
		{
			ID: "apply-clipboard-write-html", Kind: KindApply,
			Label:       "Apply: write HTML to clipboard",
			Description: "Writes configured HTML to the clipboard.",
			ConfigFields: []ConfigField{
				{
					Key: "html", Label: "HTML to write",
					Description: "The HTML content this step puts on the clipboard.",
					Default:     sampleHTML,
					Type:        FieldText,
				},
			},
		},
		{
			ID: "decision-route", Kind: KindDecision,
			Label:       "Decision: route",
			Description: "Routes to one of several next steps based on a rule evaluated against this workflow's Attributes. A pure routing point -- its conditions live on its outgoing edges (SPEC.md §3.5), not here.",
		},
	}
}

func nodeType(id string) (NodeType, bool) {
	for _, nt := range NodeTypes() {
		if nt.ID == id {
			return nt, true
		}
	}
	return NodeType{}, false
}

// newNodeID derives a collision-resistant node ID when the caller (the
// canvas, composing a brand-new node) doesn't supply one -- same random-
// suffix shape as compositionservice.go's newWorkflowID, scoped to this
// package since node IDs are a domain concern, not a service one.
func newNodeID(nodeTypeID string) string {
	suffix := make([]byte, 3)
	_, _ = rand.Read(suffix)
	return nodeTypeID + "-" + hex.EncodeToString(suffix)
}

// BuiltInWorkflows are the two workflows this prototype ships seeded --
// the same real clipboard/markdown capability internal/domain/runbook
// already ships, decomposed into nodes with explicit positions so they
// render sensibly on first canvas load without needing auto-layout. Not
// deletable (see CompositionService.DeleteWorkflow).
func BuiltInWorkflows() []Workflow {
	const loadSampleTriggerID = "load-sample-html-trigger"
	loadSample, err := ResolveNodeDefaults([]Node{
		{ID: loadSampleTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: "load-sample-html", NodeTypeID: "apply-clipboard-write-html", Position: Position{X: 0, Y: 100}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	const (
		triggerID = "clipboard-to-markdown-trigger"
		captureID = "clipboard-to-markdown-capture"
		processID = "clipboard-to-markdown-process"
		applyID   = "clipboard-to-markdown-apply"
	)
	clipboardToMarkdown, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: captureID, NodeTypeID: "capture-clipboard-html", Position: Position{X: 0, Y: 100}},
		{ID: processID, NodeTypeID: "process-html-to-markdown", Position: Position{X: 0, Y: 200}},
		{ID: applyID, NodeTypeID: "apply-clipboard-write-text", Position: Position{X: 0, Y: 300}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:          "load-sample-html-workflow",
			Label:       "Load sample HTML",
			Description: "A single-step workflow: puts real HTML on the clipboard.",
			Nodes:       loadSample,
			Edges: []Edge{
				{ID: "load-sample-html-e1", Source: loadSampleTriggerID, Target: "load-sample-html"},
			},
			BuiltIn: true,
		},
		{
			ID:          "clipboard-html-to-markdown-workflow",
			Label:       "Clipboard → Markdown",
			Description: "Capture the clipboard's HTML, convert it to Markdown, write it back.",
			Nodes:       clipboardToMarkdown,
			Edges: []Edge{
				{ID: "clipboard-to-markdown-e0", Source: triggerID, Target: captureID},
				{ID: "clipboard-to-markdown-e1", Source: captureID, Target: processID},
				{ID: "clipboard-to-markdown-e2", Source: processID, Target: applyID},
			},
			BuiltIn: true,
		},
	}
}

// ResolveNodeDefaults validates every node's NodeTypeID against
// NodeTypes(), fills in any missing config key with that field's
// Default, assigns a fresh ID to any node the caller didn't already
// give one, and derives Kind from the looked-up node type (overwriting
// whatever the client sent, so it can never drift out of sync) -- so the
// returned nodes are always fully resolved. Composing a workflow always
// configures it, even implicitly via defaults. Called once, when a
// workflow is created; never lazily at execution time.
func ResolveNodeDefaults(nodes []Node) ([]Node, error) {
	resolved := make([]Node, len(nodes))
	for i, node := range nodes {
		nt, ok := nodeType(node.NodeTypeID)
		if !ok {
			return nil, fmt.Errorf("unknown node type: %s", node.NodeTypeID)
		}

		config := make(map[string]string, len(nt.ConfigFields))
		for k, v := range node.Config {
			config[k] = v
		}
		for _, field := range nt.ConfigFields {
			if _, ok := config[field.Key]; !ok {
				config[field.Key] = field.Default
			}
			// Guards against a stale persisted value after a node type's
			// Options list changes underneath it -- e.g. a workflow saved
			// before an option was removed. Only FieldOptions has a closed
			// value set; every other type accepts whatever string is there.
			if field.Type == FieldOptions && !slices.Contains(field.Options, config[field.Key]) {
				return nil, fmt.Errorf("node %s: %q is not a valid value for %s (want one of %v)", node.NodeTypeID, config[field.Key], field.Key, field.Options)
			}
		}

		id := node.ID
		if id == "" {
			id = newNodeID(node.NodeTypeID)
		}

		resolved[i] = Node{
			ID:         id,
			Kind:       nt.Kind,
			NodeTypeID: node.NodeTypeID,
			Config:     config,
			Position:   node.Position,
		}
	}
	return resolved, nil
}

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
func attributesEnv(attrs []AttributeDef) map[string]any {
	env := make(map[string]any, len(attrs))
	for _, a := range attrs {
		switch a.Type {
		case FieldNumber:
			env[a.Key] = 0.0
		case FieldBoolean:
			env[a.Key] = false
		default:
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

	env := attributesEnv(attrs)

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

// nodeExec threads ExecContext from node to node -- Payload is the
// single-string artifact every Capture/Process/Apply node has always
// read/written (unchanged in shape here, just wrapped); Attributes is
// the new structured bag Decision rules evaluate against (see
// ExecContext's own doc comment for why it's a separate field, not a
// Payload restructuring).
var nodeExec = map[string]func(node Node, ctx ExecContext) (ExecContext, error){
	"capture-clipboard-html": func(_ Node, ctx ExecContext) (ExecContext, error) {
		html, err := readClipboardHTML()
		if err != nil {
			return ctx, err
		}
		ctx.Payload = html
		return ctx, nil
	},
	"process-html-to-markdown": func(_ Node, ctx ExecContext) (ExecContext, error) {
		md, err := htmlToMarkdown(ctx.Payload)
		if err != nil {
			return ctx, err
		}
		ctx.Payload = md
		return ctx, nil
	},
	"apply-clipboard-write-text": func(_ Node, ctx ExecContext) (ExecContext, error) {
		if err := writeClipboardText(ctx.Payload); err != nil {
			return ctx, err
		}
		return ctx, nil
	},
	"apply-clipboard-write-html": func(node Node, ctx ExecContext) (ExecContext, error) {
		html := node.Config["html"]
		if err := writeClipboardHTML(html); err != nil {
			return ctx, err
		}
		ctx.Payload = html
		return ctx, nil
	},
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
		// below); nodeExec has no entries for either by design (see
		// NodeTypes' Trigger and decision-route comments).
		if node.Kind != KindTrigger && node.Kind != KindDecision {
			exec, ok := nodeExec[node.NodeTypeID]
			if !ok {
				return "", fmt.Errorf("unknown node type: %s", node.NodeTypeID)
			}
			ctx, err = exec(node, ctx)
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

// Approach records whether a capability's mechanism is bought (an
// existing library) or must stay Mill's own hand-written code, per
// CLAUDE.md's adopt-over-hand-roll rule. Mixed means a capability splits
// cleanly into an adoptable mechanism plus a composition rule that can't
// be bought regardless of mechanism -- see ApproachDetail for which is
// which.
type Approach string

const (
	ApproachAdopt Approach = "adopt"
	ApproachBuild Approach = "build"
	ApproachMixed Approach = "mixed"
)

// MapEntry is one row of Mill's composition capability map -- real Go
// data mirroring docs/SPEC.md §3.3's table, the same "authoritative
// machine-read projection, SPEC.md's own tags stay human-readable
// commentary" relationship internal/domain/capabilities already has to
// its own SPEC.md sections (§2.2's decision record). SPEC.md §3.3 is the
// source of the reasoning; this is what the UI reads.
type MapEntry struct {
	ID             string
	Name           string
	WhatItDoes     string
	Approach       Approach
	ApproachDetail string
	Status         capabilities.Status
	StatusDetail   string
}

// CapabilityMap lists every known composition capability -- built or
// not -- so the schema/adopt-vs-build decision for §3 gets made against
// the full known need, not just today's two linear built-in workflows.
// See docs/SPEC.md §3.3 for the full reasoning behind each row.
func CapabilityMap() []MapEntry {
	return []MapEntry{
		{
			ID: "capture-process-apply", Name: "Capture / Process / Apply",
			WhatItDoes:     "Read structured state from a source, transform it, deliver it.",
			Approach:       ApproachBuild,
			ApproachDetail: "Core domain -- Mill's own already-locked primitive (§2).",
			Status:         capabilities.StatusLocked,
			StatusDetail:   "Built for clipboard/markdown.",
		},
		{
			ID: "trigger", Name: "Trigger",
			WhatItDoes: "Entry-point node: listen for any event source (hotkey, clipboard " +
				"change, a browser-bridge DOM event, an incoming MCP tools/call, a schedule) " +
				"and emit its data as the workflow's starting input -- not just \"the hotkey " +
				"mechanism,\" a general category the hotkey is one instance of. A trigger's " +
				"output is the workflow's input; these are one concept, not two.",
			Approach: ApproachMixed,
			ApproachDetail: "Each concrete event source adopts its own library behind an " +
				"adapter (hotkey, schedule via netresearch/go-cron, filesystem-watch via " +
				"fsnotify/fsnotify); clipboard-watch is a small build (no library needed, " +
				"confirmed no OS event exists to adopt). The abstraction unifying them into " +
				"one node kind, and TriggerService's own registry/exclusivity rules, are " +
				"Mill's own.",
			Status: capabilities.StatusOpen,
			StatusDetail: "KindTrigger + five NodeTypes (manual/hotkey/schedule/clipboard-" +
				"watch/filesystem-watch) built and wired through TriggerService, incl. " +
				"one-combo-per-workflow hotkey exclusivity (§3.4). DOM-event and MCP-call " +
				"triggers remain unbuilt, gated on §5/§3.1's own open questions.",
		},
		{
			ID: "decision", Name: "Decision / branching",
			WhatItDoes: "Route execution down one of several named output edges based on a " +
				"condition evaluated against the running payload.",
			Approach: ApproachMixed,
			ApproachDetail: "Node/graph semantics: build (core domain). Expression evaluation " +
				"underneath: adopt (expr-lang/expr, MIT, sandboxed/side-effect-free by design).",
			Status:       capabilities.StatusOpen,
			StatusDetail: "ADR-0005 names it, deferred. The Edge.SourceHandle field the canvas now persists is reserved for this.",
		},
		{
			ID: "parallel-steps", Name: "Parallel Steps",
			WhatItDoes: "Fan out to multiple steps concurrently, then join.",
			Approach:   ApproachMixed,
			ApproachDetail: "Graph/fan-in semantics: build. Concurrency execution: DBOS's " +
				"Queue/WithWorkerConcurrency (§7) is a plausible real backing mechanism once " +
				"designed, not hand-rolled goroutine management.",
			Status:       capabilities.StatusOpen,
			StatusDetail: "ADR-0005 names it, deferred.",
		},
		{
			ID: "child-workflow", Name: "Child Workflow",
			WhatItDoes:     "One workflow invokes another as a step.",
			Approach:       ApproachBuild,
			ApproachDetail: "Composition rule -- no library has an opinion on Mill's own workflow-of-workflows semantics.",
			Status:         capabilities.StatusOpen,
			StatusDetail:   "ADR-0005 names it, deferred.",
		},
		{
			ID: "connector", Name: "Integration / Connector node",
			WhatItDoes: "Call an external HTTP API, auth'd.",
			Approach:   ApproachMixed,
			ApproachDetail: "Wire protocol: adopt (stdlib net/http, or MCP per §3.1 if exposed " +
				"as a tool). Connector config/credential model: build.",
			Status:       capabilities.StatusOpen,
			StatusDetail: "§4, open.",
		},
		{
			ID: "durable-execution", Name: "Durable step execution / retry / resume",
			WhatItDoes:     "Survive the process dying mid-workflow, checkpoint per step, retry transient failures.",
			Approach:       ApproachAdopt,
			ApproachDetail: "DBOS-Go.",
			Status:         capabilities.StatusOpen,
			StatusDetail:   "ADR-0004, proposed -- integration paused pending this UI-first pass.",
		},
		{
			ID: "replay", Name: "Replay / re-run from history",
			WhatItDoes:     "Re-invoke a past run, ideally resuming rather than restarting.",
			Approach:       ApproachMixed,
			ApproachDetail: "Mechanism: adopt (DBOS ForkWorkflow/workflow-ID resume). UI/policy: build.",
			Status:         capabilities.StatusOpen,
			StatusDetail:   "Named this session, not built.",
		},
		{
			ID: "versioning", Name: "Draft/live versioning",
			WhatItDoes:     "Edit a workflow without breaking the currently-live version.",
			Approach:       ApproachBuild,
			ApproachDetail: "No library owns Mill's own versioning semantics.",
			Status:         capabilities.StatusOpen,
			StatusDetail:   "Real gap flagged from the reference-platform review (§3.2).",
		},
		{
			ID: "shadow-events", Name: "Live + shadow events / execution history",
			WhatItDoes:     "Filterable log of past runs; dry-run a candidate change against real traffic before trusting it.",
			Approach:       ApproachMixed,
			ApproachDetail: "Data: adopt (DBOS GetStatus/ListWorkflows). UI: build.",
			Status:         capabilities.StatusOpen,
			StatusDetail:   "§3.2 shadow-events bullet; §7 already calls Activity \"the closest thing to the analytics half.\"",
		},
		{
			ID: "guardrail-preview", Name: "Guardrail preview / policy gate",
			WhatItDoes:     "Approve/deny before a step actually runs.",
			Approach:       ApproachBuild,
			ApproachDetail: "Core domain -- no library has an opinion on Mill's guardrail semantics.",
			Status:         capabilities.StatusOpen,
			StatusDetail:   "§8, locked in shape, open in detail.",
		},
		{
			ID: "visual-composition", Name: "Visual composition surface",
			WhatItDoes: "Author a DAG, not just a list.",
			Approach:   ApproachAdopt,
			ApproachDetail: "React Flow / @xyflow/react, adopted -- built ahead of ADR-0005 " +
				"B2's original \"2+ real multi-step workflows\" deferral trigger, by explicit " +
				"decision (see the ADR's Update section).",
			Status: capabilities.StatusOpen,
			StatusDetail: "§3 -- canvas built and real (drag-and-drop, undo/redo, auto-layout), " +
				"still UX: PROTOTYPE, not the final authoring surface.",
		},
	}
}
