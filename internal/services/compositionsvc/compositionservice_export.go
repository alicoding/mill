package compositionsvc

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
)

// exportedWorkflow is the portable, on-disk JSON shape for a workflow
// export/import round trip -- deliberately its own type rather than
// reusing composition.Workflow directly, so the wire shape can omit
// ID and BuiltIn without ad hoc json:"-" tags on the domain type.
//
// ID is omitted by design, not oversight: importing a workflow always
// creates a NEW one with a freshly generated ID (ImportWorkflow below
// delegates straight to CreateWorkflow, which already does this),
// matching the precedent ADR-0013's Duplicate already established for
// connectors -- copying/bringing in an entity means a new identity, not
// resurrecting the old one, so importing the same file twice (or into a
// different Mill instance) can never silently collide with or overwrite
// an existing workflow. Node/Edge IDs inside the graph ARE preserved
// as-is: those are relative references (Edge.Source/Target point at a
// Node.ID within the same file), not global identity, and must stay
// intact for the graph to reconstruct correctly.
//
// Stable/deterministic by construction, not by extra bookkeeping: every
// field here is already-stored data (never regenerated on save), and
// Go's encoding/json guarantees deterministic output for it -- struct
// fields marshal in a fixed declaration order and map[string]string
// (Node.Config) marshals with keys sorted, confirmed against the
// encoding/json source, not assumed. Two exports of an unchanged
// workflow therefore produce byte-identical JSON, so a workflow
// committed to git diffs cleanly on a real change and not otherwise --
// this is the concrete answer to n8n's own documented pain point
// (real-world exports include volatile internal IDs/timestamps that
// make two exports of the same unchanged workflow look different to
// git), confirmed via research before designing this shape, not
// assumed absent.
//
// ID (docs/goals/0039) is an EXCEPTION to "never carries id" above, and
// deliberately asymmetric: ExportWorkflow below never sets it (the
// export wire shape is unchanged, still omits id via omitempty), but
// the shape now ACCEPTS one on the way in -- clipboard-apply's
// create-vs-update decision (compositionservice_clipboardapply.go)
// reads it to tell "no id -- create" (today's ImportWorkflow semantics,
// untouched) from "id present and matches a real workflow here --
// update through the same SnapshotDraft+UpdateWorkflowFromExport
// chokepoint MCP's update_workflow tool already uses" apart. Whether
// ExportWorkflow itself should start emitting id (e.g. for a
// push-my-edits-back round trip) is an explicit open question left to
// a future share-story goal, not resolved here.
type exportedWorkflow struct {
	ID          string                     `json:"id,omitempty"`
	Label       string                     `json:"label"`
	Description string                     `json:"description"`
	Nodes       []composition.Node         `json:"nodes"`
	Edges       []composition.Edge         `json:"edges"`
	Attributes  []composition.AttributeDef `json:"attributes"`
}

// ExportWorkflow serializes id's current definition as an indented,
// portable JSON string -- share it, commit it to git, or import it into
// another Mill instance. Read-only: never mutates c.user, never touches
// the settings store.
func (c *CompositionService) ExportWorkflow(id string) (string, error) {
	c.mu.Lock()
	var wf composition.Workflow
	found := false
	for _, w := range c.user {
		if w.ID == id {
			wf = w
			found = true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return "", fmt.Errorf("no workflow with id %q", id)
	}

	out := exportedWorkflow{
		Label:       wf.Label,
		Description: wf.Description,
		Nodes:       wf.Nodes,
		Edges:       wf.Edges,
		Attributes:  wf.Attributes,
	}
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export workflow: %w", err)
	}
	return string(data), nil
}

// ImportWorkflow parses jsonData (ExportWorkflow's own output, or a
// hand-authored file in the same shape) and composes it as a brand-new
// workflow -- see exportedWorkflow's own doc comment for why a new ID
// is always generated rather than the file's origin workflow being
// resurrected/overwritten. Reuses CreateWorkflow for validation
// (ResolveNodeDefaults, ValidateGraph, the label/non-empty-nodes
// checks) rather than duplicating it -- an imported workflow is held to
// exactly the same bar as one composed by hand on the canvas, no
// import-specific leniency. Attributes apply as a second step through
// UpdateAttributes, matching the existing compose-then-configure-
// attributes flow every hand-composed workflow already goes through
// (Configure's Attributes tab) -- not a special import-only path.
func (c *CompositionService) ImportWorkflow(jsonData string) (composition.Workflow, error) {
	var in exportedWorkflow
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return composition.Workflow{}, fmt.Errorf("import workflow: invalid JSON: %w", err)
	}

	wf, err := c.CreateWorkflow(in.Label, in.Description, in.Nodes, in.Edges)
	if err != nil {
		return composition.Workflow{}, err
	}

	if len(in.Attributes) == 0 {
		return wf, nil
	}
	return c.UpdateAttributes(wf.ID, in.Attributes)
}

// SnapshotDraft captures id's current draft head as a new immutable
// version WITHOUT publishing it -- the auto-snapshot-before-write
// safety net for MCP-driven authoring (docs/adr/0025): anything an
// external LLM changes is one "load into draft" away from undone,
// which is a stronger guarantee than forbidding updates ever was.
func (c *CompositionService) SnapshotDraft(id string) (composition.Workflow, error) {
	return c.mutateWorkflow(id, func(wf composition.Workflow) (composition.Workflow, error) {
		wf.Versions = append(wf.Versions, composition.SnapshotHead(wf, time.Now()))
		return wf, nil
	})
}

// UpdateWorkflowFromExport replaces id's draft head with an
// exported-workflow JSON definition -- the same wire shape
// ExportWorkflow produces and ImportWorkflow consumes, reused as the
// update protocol so there is exactly one document format
// (docs/adr/0025). Validation is UpdateWorkflow's own (ValidateGraph,
// ResolveNodeDefaults); attributes update alongside when present.
func (c *CompositionService) UpdateWorkflowFromExport(id, jsonData string) (composition.Workflow, error) {
	var in exportedWorkflow
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return composition.Workflow{}, fmt.Errorf("update workflow: invalid JSON: %w", err)
	}
	wf, err := c.UpdateWorkflow(id, in.Label, in.Description, in.Nodes, in.Edges)
	if err != nil {
		return composition.Workflow{}, err
	}
	if in.Attributes == nil {
		return wf, nil
	}
	return c.UpdateAttributes(id, in.Attributes)
}
