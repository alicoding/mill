package composition

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"slices"
)

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
		{
			ID: "integration-http", Kind: KindProcess,
			Label:       "Integration: HTTP call",
			Description: "Calls a Configure-authored connector's API and replaces the payload with the response body. connectorId isn't a closed FieldOptions set (unlike method below) because connectors are runtime, Configure-authored data composition.go has no compile-time knowledge of -- paste the ID from the Configure page's connector list until a live dropdown lands there (docs/SPEC.md §3.5).",
			ConfigFields: []ConfigField{
				{
					Key: "connectorId", Label: "Connector ID",
					Description: "The ID of a connector configured on the Configure page.",
					Default:     "", Type: FieldText,
				},
				{
					Key: "path", Label: "Path",
					Description: "Appended to the connector's base URL, e.g. \"/v1/records\".",
					Default:     "", Type: FieldText,
				},
				{
					Key: "method", Label: "Method",
					Description: "HTTP method for this call.",
					Default:     http.MethodGet, Type: FieldOptions,
					Options: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch},
				},
				{
					Key: "bodyTemplate", Label: "Body",
					Description: "Optional request body (e.g. JSON), sent as-is.",
					Default:     "", Type: FieldText,
				},
			},
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
