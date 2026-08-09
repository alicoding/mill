package main

import (
	"encoding/json"
	"fmt"

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
type exportedWorkflow struct {
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
