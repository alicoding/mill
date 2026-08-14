package compositionsvc

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/contract"
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
// ID (docs/goals/0039, resolved by ADR-0036) is an EXCEPTION to "never
// carries id" above: ExportWorkflow now always emits the workflow's
// real id, and the shape accepts one on the way in too -- the same
// field drives both directions of the uniform import rule (ADR-0036
// decision 3, implemented in ImportWorkflow below): absent -> create a
// fresh id; present and unknown locally -> create preserving it (the
// two-machine bridge identity ADR-0036 exists for); present and known
// locally -> update through the same SnapshotDraft+
// UpdateWorkflowFromExport chokepoint MCP's update_workflow tool
// already uses. Schema carries the envelope's contract id (ADR-0036
// decision 2) -- absent is accepted on import (every pre-ADR-0036
// export), present is validated by contract.ValidateImportSchema.
type exportedWorkflow struct {
	Schema      string                     `json:"schema"`
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
		Schema:      contract.SchemaID("workflow"),
		ID:          wf.ID,
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
// hand-authored file in the same shape) and applies ADR-0036 decision
// 3's uniform import rule: no id -> create fresh (delegates to
// CreateWorkflow, held to exactly the same validation bar as a
// hand-composed workflow, no import-specific leniency); an id unknown
// here -> create preserving that id; an id matching a local workflow ->
// update through the same snapshot-then-replace chokepoint MCP's
// update_workflow tool uses. Attributes apply as a second step through
// UpdateAttributes on the create paths, matching the existing compose-
// then-configure-attributes flow every hand-composed workflow already
// goes through (Configure's Attributes tab).
func (c *CompositionService) ImportWorkflow(jsonData string) (composition.Workflow, error) {
	var in exportedWorkflow
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return composition.Workflow{}, fmt.Errorf("import workflow: invalid JSON: %w", err)
	}
	if err := contract.ValidateImportSchema("workflow", in.Schema); err != nil {
		return composition.Workflow{}, fmt.Errorf("import workflow: %w", err)
	}

	if in.ID != "" {
		c.mu.Lock()
		found := c.workflowExistsLocked(in.ID)
		c.mu.Unlock()
		if found {
			if _, err := c.SnapshotDraft(in.ID); err != nil {
				return composition.Workflow{}, err
			}
			return c.UpdateWorkflowFromExport(in.ID, jsonData)
		}
		wf, err := c.createWorkflowWithID(in.ID, in.Label, in.Description, in.Nodes, in.Edges)
		if err != nil {
			return composition.Workflow{}, err
		}
		if len(in.Attributes) == 0 {
			return wf, nil
		}
		return c.UpdateAttributes(wf.ID, in.Attributes)
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
