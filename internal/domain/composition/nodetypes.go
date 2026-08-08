package composition

import (
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
