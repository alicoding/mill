package compositionsvc

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/domain/composition"
)

// docs/goals/0039: "Apply from clipboard..." in the Quick Panel --
// paste the SAME exported-workflow JSON the UI's own Export button and
// MCP's import_workflow/update_workflow tools already consume (n8n's
// own share/import precedent: one canonical document, one accepting
// path, every entry point just another door onto it). Deliberately NOT
// routed through gateWrite/park-and-poll (docs/adr/0032): that model
// exists because an MCP write's originator might be away when it
// fires; a clipboard apply is user-attended by construction -- pressing
// the summon hotkey and clicking the row IS the human being present --
// so this is a plain preview-then-confirm, one Confirm, no double-
// gating, and the MCP writes-approval setting never touches it.

// ClipboardApplyKind identifies the recognized payload shape --
// "workflow" is the only one this goal implements (structure-sniffed by
// the presence of both "nodes" and "edges"). Other Configure-entity
// export shapes (HTTPRequest/List/MCPServer/Decision,
// configureservice_export.go) are a named, deliberate follow-up, not
// silently dropped -- see the goal file.
type ClipboardApplyKind string

const ClipboardApplyKindWorkflow ClipboardApplyKind = "workflow"

// ClipboardApplyAction is what ConfirmClipboardApply will actually do,
// as already determined by PreviewClipboardApply.
type ClipboardApplyAction string

const (
	ClipboardApplyActionCreate ClipboardApplyAction = "create"
	ClipboardApplyActionUpdate ClipboardApplyAction = "update"
)

// ClipboardUnresolvedRef is one dangling reference found while walking
// the parsed payload's nodes (docs/goals/0039 item 5, the sharing-
// research verdict: surfaced non-blocking, never auto-created).
type ClipboardUnresolvedRef struct {
	NodeID  string `json:"nodeID"`
	Field   string `json:"field"`
	RefKind string `json:"refKind"`
	Value   string `json:"value"`
}

// ClipboardApplyPreview is PreviewClipboardApply's return value -- a
// value, not an error, for the malformed/unrecognized case: Recognized
// is false and Error carries a readable message so the panel can render
// it inline (time-honesty, .claude/rules/testing.md -- never silent).
// The Go `error` return on both RPCs below is reserved for a genuine
// internal failure, not a bad clipboard payload.
type ClipboardApplyPreview struct {
	Recognized bool                     `json:"recognized"`
	Error      string                   `json:"error,omitempty"`
	Kind       ClipboardApplyKind       `json:"kind,omitempty"`
	Action     ClipboardApplyAction     `json:"action,omitempty"`
	WorkflowID string                   `json:"workflowID,omitempty"`
	Label      string                   `json:"label,omitempty"`
	NodeCount  int                      `json:"nodeCount,omitempty"`
	Note       string                   `json:"note,omitempty"`
	Unresolved []ClipboardUnresolvedRef `json:"unresolved,omitempty"`
}

// detectClipboardPayloadKind structure-sniffs raw JSON the same way MCP's
// own tools discriminate export shapes: a workflow payload carries both
// "nodes" and "edges" arrays (exportedWorkflow's own wire shape); no
// other recognized kind exists yet.
func detectClipboardPayloadKind(jsonData string) (ClipboardApplyKind, bool) {
	var probe struct {
		Nodes json.RawMessage `json:"nodes"`
		Edges json.RawMessage `json:"edges"`
	}
	if err := json.Unmarshal([]byte(jsonData), &probe); err != nil {
		return "", false
	}
	if probe.Nodes != nil && probe.Edges != nil {
		return ClipboardApplyKindWorkflow, true
	}
	return "", false
}

// PreviewClipboardApply parses jsonData (clipboard contents) and reports
// what ConfirmClipboardApply would do WITHOUT persisting anything --
// docs/goals/0039's preview-confirm model. See ClipboardApplyPreview's
// own doc comment for why malformed/unrecognized input is a value, not
// an error.
func (c *CompositionService) PreviewClipboardApply(jsonData string) (ClipboardApplyPreview, error) {
	kind, ok := detectClipboardPayloadKind(jsonData)
	if !ok {
		return ClipboardApplyPreview{Error: "this doesn't look like a Mill export -- copy a workflow's \"Export\" output (or another Mill instance's clipboard-apply payload) and try again"}, nil
	}
	if kind != ClipboardApplyKindWorkflow {
		return ClipboardApplyPreview{Error: fmt.Sprintf("unrecognized payload shape %q", kind)}, nil
	}

	var in exportedWorkflow
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return ClipboardApplyPreview{Error: "not valid JSON: " + err.Error()}, nil
	}
	if in.Label == "" || len(in.Nodes) == 0 {
		return ClipboardApplyPreview{Error: "not a valid workflow export -- missing a label or any nodes"}, nil
	}

	preview := ClipboardApplyPreview{
		Recognized: true,
		Kind:       ClipboardApplyKindWorkflow,
		Label:      in.Label,
		NodeCount:  len(in.Nodes),
		Unresolved: c.unresolvedRefs(in.Nodes),
	}

	if in.ID == "" {
		preview.Action = ClipboardApplyActionCreate
		return preview, nil
	}

	c.mu.Lock()
	found := c.workflowExistsLocked(in.ID)
	c.mu.Unlock()
	if !found {
		preview.Action = ClipboardApplyActionCreate
		preview.Note = fmt.Sprintf("no workflow with id %q exists here -- this will create a new workflow instead of updating", in.ID)
		return preview, nil
	}
	preview.Action = ClipboardApplyActionUpdate
	preview.WorkflowID = in.ID
	return preview, nil
}

// ConfirmClipboardApply re-parses jsonData and applies it -- create or
// update, independently re-deriving the Action rather than trusting a
// caller-cached preview verdict, since the clipboard/workflow list could
// have changed between preview and confirm.
func (c *CompositionService) ConfirmClipboardApply(jsonData string) (composition.Workflow, error) {
	kind, ok := detectClipboardPayloadKind(jsonData)
	if !ok {
		return composition.Workflow{}, fmt.Errorf("clipboard apply: unrecognized payload shape")
	}
	if kind != ClipboardApplyKindWorkflow {
		return composition.Workflow{}, fmt.Errorf("clipboard apply: unsupported payload kind %q", kind)
	}

	var in exportedWorkflow
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return composition.Workflow{}, fmt.Errorf("clipboard apply: invalid JSON: %w", err)
	}

	if in.ID != "" {
		c.mu.Lock()
		found := c.workflowExistsLocked(in.ID)
		c.mu.Unlock()
		if found {
			// The exact chokepoint MCP's update_workflow tool uses
			// (millmcpservice_authoring.go): snapshot the current draft
			// first (always revertible from Versions), then replace it.
			if _, err := c.SnapshotDraft(in.ID); err != nil {
				return composition.Workflow{}, err
			}
			return c.UpdateWorkflowFromExport(in.ID, jsonData)
		}
		// id present but no local match -- falls through to create,
		// matching PreviewClipboardApply's own create-with-a-note verdict.
	}
	return c.ImportWorkflow(jsonData)
}

// workflowExistsLocked reports whether id names a real local workflow --
// callers must hold c.mu. The same linear scan ExportWorkflow/
// UpdateWorkflow already do inline; pulled out here since this file
// needs it in two places (PreviewClipboardApply's create-vs-update
// check, and ConfirmClipboardApply's own independent re-check) and
// neither wants the matched Workflow itself, only the yes/no.
func (c *CompositionService) workflowExistsLocked(id string) bool {
	for _, w := range c.user {
		if w.ID == id {
			return true
		}
	}
	return false
}

// unresolvedRefs walks nodes for docs/goals/0039 item 5's dangling-
// reference preview: a NodeTypeID this instance's registry doesn't
// recognize, or a non-empty RefKind-bearing config value that doesn't
// resolve to a real local entity. Non-blocking by design (ADR-0028's
// warning-severity precedent) -- this only ever informs the preview,
// never rejects ConfirmClipboardApply.
func (c *CompositionService) unresolvedRefs(nodes []composition.Node) []ClipboardUnresolvedRef {
	catalog := make(map[string]composition.NodeType, len(composition.NodeTypes()))
	for _, nt := range composition.NodeTypes() {
		catalog[nt.ID] = nt
	}

	workflowIDs := make(map[string]bool)
	c.mu.Lock()
	for _, w := range c.user {
		workflowIDs[w.ID] = true
	}
	c.mu.Unlock()

	var out []ClipboardUnresolvedRef
	for _, n := range nodes {
		nt, ok := catalog[n.NodeTypeID]
		if !ok {
			out = append(out, ClipboardUnresolvedRef{NodeID: n.ID, Field: "nodeTypeID", RefKind: "node-type", Value: n.NodeTypeID})
			continue // no ConfigFields catalog to check this node's Config against
		}
		for _, field := range nt.ConfigFields {
			if field.RefKind == "" {
				continue
			}
			value := strings.TrimSpace(n.Config[field.Key])
			if value == "" {
				continue // "not configured yet" is validateRequiredRefs' own warning, not a dangling reference
			}
			var resolved bool
			switch field.RefKind {
			case "workflow", "workflow-scope":
				resolved = workflowIDs[value]
			default:
				resolved = composition.RefExists(field.RefKind, value)
			}
			if !resolved {
				out = append(out, ClipboardUnresolvedRef{NodeID: n.ID, Field: field.Key, RefKind: field.RefKind, Value: value})
			}
		}
	}
	return out
}
