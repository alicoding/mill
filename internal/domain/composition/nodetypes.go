package composition

import (
	"github.com/alicoding/mill/internal/domain/httprequest"

	"crypto/rand"
	"encoding/hex"
	"fmt"
	"slices"
	"sort"
)

// kindOrder is NodeTypes()'s display-order tiebreaker -- Trigger nodes
// first (a workflow's root, matching linearOrder's "exactly one
// starting node" expectation), then Capture/Process/Apply/Decision, the
// same sequence the old literal slice used. Reading from a map
// (nodeTypeRegistry, registry.go) has no ordering guarantee of its own,
// so NodeTypes() sorts explicitly rather than depending on Go's
// init()-file-order behavior, which is real but not worth relying on
// silently (docs/adr/0006-extension-point-registration.md).
var kindOrder = map[NodeKind]int{
	KindTrigger:  0,
	KindCapture:  1,
	KindProcess:  2,
	KindApply:    3,
	KindDecision: 4,
}

func NodeTypes() []NodeType {
	out := make([]NodeType, 0, len(nodeTypeRegistry))
	for _, entry := range nodeTypeRegistry {
		out = append(out, entry.nodeType)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return kindOrder[out[i].Kind] < kindOrder[out[j].Kind]
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func nodeType(id string) (NodeType, bool) {
	entry, ok := nodeTypeRegistry[id]
	return entry.nodeType, ok
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

	// The guardrail proof (docs/adr/0022, and the standing seeded-
	// examples principle): an external-effect step whose run parks
	// awaiting approval by default. References the seeded no-auth
	// HTTPRequest by its exported ID constant rather than a string that
	// could drift.
	const (
		guardedTriggerID = "example-guarded-trigger"
		guardedHTTPID    = "example-guarded-http"
	)
	guardedNodes, err := ResolveNodeDefaults([]Node{
		{ID: guardedTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: guardedHTTPID, NodeTypeID: "integration-http", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"requestId": httprequest.ExampleNoneID}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	// A seeded parent/child pair demonstrating docs/adr/0010 end to end
	// (prompted directly): the child is callable-only with a typed input
	// (its declared "message" Attribute, read into the payload by
	// capture-attribute); the parent invokes it with a bound input and
	// stores the child's typed output into its own "childResult"
	// Attribute via child-workflow's outputAttribute.
	const (
		childTriggerID = "example-child-trigger"
		childCaptureID = "example-child-capture"
		childInjectID  = "example-child-inject"
	)
	// The child ships with TWO definitions (ADR-0021, and the standing
	// seeded-examples principle: a seed must exercise the feature it
	// demonstrates): v1 -- published, what the pinned parent and any
	// live caller executes -- and a newer, deliberately different DRAFT
	// head, proving edits never leak into production until published.
	childV1Nodes, err := ResolveNodeDefaults([]Node{
		{ID: childTriggerID, NodeTypeID: "trigger-callable", Position: Position{X: 0, Y: 0}},
		{ID: childCaptureID, NodeTypeID: "capture-attribute", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"attribute": "message"}},
		{ID: childInjectID, NodeTypeID: "process-inject-text", Position: Position{X: 0, Y: 200},
			Config: map[string]string{"text": "(processed by the child workflow, v1)", "placement": "append"}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}
	childDraftNodes, err := ResolveNodeDefaults([]Node{
		{ID: childTriggerID, NodeTypeID: "trigger-callable", Position: Position{X: 0, Y: 0}},
		{ID: childCaptureID, NodeTypeID: "capture-attribute", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"attribute": "message"}},
		{ID: childInjectID, NodeTypeID: "process-inject-text", Position: Position{X: 0, Y: 200},
			Config: map[string]string{"text": "(child DRAFT -- publish to make this live)", "placement": "append"}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	const (
		parentTriggerID = "example-parent-trigger"
		parentChildID   = "example-parent-child-step"
	)
	parentNodes, err := ResolveNodeDefaults([]Node{
		{ID: parentTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: parentChildID, NodeTypeID: "child-workflow", Position: Position{X: 0, Y: 100},
			Config: map[string]string{
				"workflowId": ExampleChildWorkflowID,
				// Pinned to v1 (ADR-0021): the child's draft says
				// something different on purpose -- running this parent
				// proves the pin (and that drafts never leak).
				"version":         "1",
				"inputBindings":   `{"message":"hello from the parent workflow"}`,
				"outputAttribute": "childResult",
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	// A disabled scheduled workflow (ADR-0021's inactive state): its
	// every-minute schedule never arms while Disabled -- flip the
	// toggle to watch it start firing into Activity.
	const (
		disabledTriggerID = "example-disabled-trigger"
		disabledInjectID  = "example-disabled-inject"
	)
	disabledNodes, err := ResolveNodeDefaults([]Node{
		{ID: disabledTriggerID, NodeTypeID: "trigger-schedule", Position: Position{X: 0, Y: 0},
			Config: map[string]string{"cron": "* * * * *"}},
		{ID: disabledInjectID, NodeTypeID: "process-inject-text", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"text": "the disabled example fired -- you enabled it", "placement": "append"}},
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
		{
			ID:          ExampleChildWorkflowID,
			Label:       "Example: Echo message (callable child)",
			Description: "Only runnable by another workflow (its trigger is \"callable by another workflow\"). Takes a typed input -- its declared 'message' Attribute -- reads it into the payload, and appends a marker. Ships with v1 PUBLISHED and a deliberately different DRAFT (ADR-0021): callers see v1; the draft's changed text only goes live when you publish it.",
			Nodes:       childDraftNodes,
			Attributes:  []AttributeDef{{Key: "message", Label: "Message", Type: FieldText}},
			Edges: []Edge{
				{ID: "example-child-e0", Source: childTriggerID, Target: childCaptureID},
				{ID: "example-child-e1", Source: childCaptureID, Target: childInjectID},
			},
			BuiltIn:          true,
			PublishedVersion: 1,
			Versions: []WorkflowVersion{{
				Version:     1,
				Label:       "Example: Echo message (callable child)",
				Description: "v1 -- the published snapshot pinned by the parent example.",
				Nodes:       childV1Nodes,
				Attributes:  []AttributeDef{{Key: "message", Label: "Message", Type: FieldText}},
				Edges: []Edge{
					{ID: "example-child-e0", Source: childTriggerID, Target: childCaptureID},
					{ID: "example-child-e1", Source: childCaptureID, Target: childInjectID},
				},
			}},
		},
		{
			ID:          "example-parent-workflow",
			Label:       "Example: Parent → child call",
			Description: "Invokes the callable child with a typed input bound to its 'message' Attribute, PINNED to the child's v1 (ADR-0021) -- the child's newer draft says something different on purpose, and running this proves the pin holds. The child's result becomes this workflow's payload and is also stored into its 'childResult' Attribute (typed output).",
			Nodes:       parentNodes,
			Attributes:  []AttributeDef{{Key: "childResult", Label: "Child result", Type: FieldText}},
			Edges: []Edge{
				{ID: "example-parent-e0", Source: parentTriggerID, Target: parentChildID},
			},
			BuiltIn: true,
		},
		{
			ID:          "example-guarded-http-workflow",
			Label:       "Example: Approval-gated HTTP call",
			Description: "Calls the seeded no-auth httpbin.org integration -- an EXTERNAL-effect step, so running it parks awaiting your approval (docs/SPEC.md §8's fail-safe default: friction is the default, speed is the opt-in). Approve or deny it from this workflow's own Runs tab. To skip the ask for trusted steps, add an allow rule under Configure > Guardrails -- and dry-run the rule there before relying on it.",
			Nodes:       guardedNodes,
			Edges: []Edge{
				{ID: "example-guarded-e0", Source: guardedTriggerID, Target: guardedHTTPID},
			},
			BuiltIn: true,
		},
		{
			ID:          "example-disabled-schedule-workflow",
			Label:       "Example: Disabled schedule",
			Description: "An every-minute schedule that never fires -- it ships DISABLED (ADR-0021's inactive state), so its trigger doesn't even arm. Enable it (the workflow's own toggle) and watch it start appearing in Activity each minute; disable it again to pause production without deleting anything. Test runs work even while disabled.",
			Nodes:       disabledNodes,
			Edges: []Edge{
				{ID: "example-disabled-e0", Source: disabledTriggerID, Target: disabledInjectID},
			},
			BuiltIn:  true,
			Disabled: true,
		},
	}
}

// ExampleChildWorkflowID is exported so the parent seed above and any
// test/UI affordance can reference the child without a string literal
// that could drift.
const ExampleChildWorkflowID = "example-child-echo-workflow"

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
