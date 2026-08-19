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
// an existing workflow. Step/Edge IDs inside the graph ARE preserved
// as-is: those are relative references (Edge.Source/Target point at a
// Step.ID within the same file), not global identity, and must stay
// intact for the graph to reconstruct correctly.
//
// Stable/deterministic by construction, not by extra bookkeeping: every
// field here is already-stored data (never regenerated on save), and
// Go's encoding/json guarantees deterministic output for it -- struct
// fields marshal in a fixed declaration order and map[string]string
// (Step.Config) marshals with keys sorted, confirmed against the
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
//
// Steps (docs/goals/0053 tier 2) is the wire-vocabulary rename of what
// used to be the "nodes" key -- composition.Node/Edge/Workflow carry NO
// json tags of their own and marshal through encoding/json's own
// capitalized-field-name default, and that exact same untagged shape is
// what persist()/restore() (compositionservice.go) already
// json.Marshal/Unmarshal into the settings store for every saved
// workflow, and what executionsvc's DBOS runInput checkpoints into
// durable storage. Renaming a tag directly on composition.Node would
// silently stop either from round-tripping already-persisted data, so
// this envelope uses its own dedicated Step DTO (below) instead of
// composition.Node directly -- isolating the export/import wire rename
// from the shared, untagged domain shape entirely. UnmarshalJSON below
// accepts the legacy "nodes" key forever (every export produced before
// this rename).
// Notes (docs/goals/0055, ADR-0036 decision 2) is an ADDITIVE-OPTIONAL
// envelope field: `omitempty` so an export with no notes stays
// byte-identical to a pre-0055 one, and every existing importer already
// ignores an unknown/absent field -- no schema major bump.
type exportedWorkflow struct {
	Schema      string                     `json:"schema"`
	ID          string                     `json:"id,omitempty"`
	Label       string                     `json:"label"`
	Description string                     `json:"description"`
	Steps       []Step                     `json:"steps"`
	Edges       []composition.Edge         `json:"edges"`
	Notes       []composition.Note         `json:"notes,omitempty"`
	Attributes  []composition.AttributeDef `json:"attributes"`
	// OfferOnRequestID (goal 0126) is additive-optional like Notes:
	// omitempty keeps offer-less exports byte-identical, absent
	// imports unmarshal to the zero value. offerKeyPresent records
	// whether the source document carried the key at all -- the same
	// nil-vs-absent distinction Notes gets for free from its slice
	// type, needed so an older export can never wipe an existing
	// workflow's offer on the update-in-place path.
	OfferOnRequestID string `json:"offerOnRequestId,omitempty"`
	offerKeyPresent  bool
}

// UnmarshalJSON accepts the current "steps" key and, forever, the
// legacy "nodes" key every export produced before docs/goals/0053 tier
// 2 -- a workflow committed to git, or an external agent's cached
// export, keeps importing to an identical result. "steps" wins when a
// document somehow carries both.
func (w *exportedWorkflow) UnmarshalJSON(data []byte) error {
	var raw struct {
		Schema           string                     `json:"schema"`
		ID               string                     `json:"id,omitempty"`
		Label            string                     `json:"label"`
		Description      string                     `json:"description"`
		Steps            []Step                     `json:"steps"`
		LegacyNodes      []Step                     `json:"nodes"`
		Edges            []composition.Edge         `json:"edges"`
		Notes            []composition.Note         `json:"notes,omitempty"`
		Attributes       []composition.AttributeDef `json:"attributes"`
		OfferOnRequestID *string                    `json:"offerOnRequestId"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	steps := raw.Steps
	if len(steps) == 0 && len(raw.LegacyNodes) > 0 {
		steps = raw.LegacyNodes
	}
	*w = exportedWorkflow{
		Schema: raw.Schema, ID: raw.ID, Label: raw.Label, Description: raw.Description,
		Steps: steps, Edges: raw.Edges, Notes: raw.Notes, Attributes: raw.Attributes,
	}
	if raw.OfferOnRequestID != nil {
		w.OfferOnRequestID = *raw.OfferOnRequestID
		w.offerKeyPresent = true
	}
	return nil
}

// Step is exportedWorkflow's own per-step wire shape -- see
// exportedWorkflow's doc comment for why this is a dedicated DTO rather
// than composition.Node directly. StepTypeID replaces what used to be
// the "NodeTypeID" wire key (docs/goals/0053 tier 2); UnmarshalJSON
// below accepts the legacy key forever, the same "steps"/"nodes"
// fallback exportedWorkflow itself implements one level up.
type Step struct {
	ID         string
	Kind       composition.NodeKind
	StepTypeID string
	Config     map[string]string
	Position   composition.Position
}

// UnmarshalJSON accepts the current "StepTypeID" key and, forever, the
// legacy "NodeTypeID" key -- "StepTypeID" wins when a document somehow
// carries both.
func (s *Step) UnmarshalJSON(data []byte) error {
	var raw struct {
		ID             string
		Kind           composition.NodeKind
		StepTypeID     string
		LegacyNodeType string `json:"NodeTypeID"`
		Config         map[string]string
		Position       composition.Position
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	s.ID, s.Kind, s.Config, s.Position = raw.ID, raw.Kind, raw.Config, raw.Position
	s.StepTypeID = raw.StepTypeID
	if s.StepTypeID == "" {
		s.StepTypeID = raw.LegacyNodeType
	}
	return nil
}

// stepsFromNodes/nodesFromSteps convert between the wire DTO above and
// composition.Node -- the domain type every CompositionService method
// (CreateWorkflow, UpdateWorkflow, ...) actually takes, unchanged by
// this rename.
func stepsFromNodes(nodes []composition.Node) []Step {
	out := make([]Step, len(nodes))
	for i, n := range nodes {
		out[i] = Step{ID: n.ID, Kind: n.Kind, StepTypeID: n.NodeTypeID, Config: n.Config, Position: n.Position}
	}
	return out
}

func nodesFromSteps(steps []Step) []composition.Node {
	out := make([]composition.Node, len(steps))
	for i, s := range steps {
		out[i] = composition.Node{ID: s.ID, Kind: s.Kind, NodeTypeID: s.StepTypeID, Config: s.Config, Position: s.Position}
	}
	return out
}

// DecodeWorkflowGraph parses jsonData (exported-workflow JSON, or a
// hand-authored document in the same shape) into its label/nodes/edges/
// attributes, accepting both the current "steps" and the legacy
// "nodes" wire vocabulary (docs/goals/0053 tier 2) -- exported for
// callers (MCP's validate_workflow / update_workflow diff preview) that
// only need the parsed graph, not a persisted CompositionService, so
// there is exactly one implementation of the dual-vocabulary parse.
func DecodeWorkflowGraph(jsonData string) (label string, nodes []composition.Node, edges []composition.Edge, attributes []composition.AttributeDef, err error) {
	var in exportedWorkflow
	if err = json.Unmarshal([]byte(jsonData), &in); err != nil {
		return "", nil, nil, nil, err
	}
	return in.Label, nodesFromSteps(in.Steps), in.Edges, in.Attributes, nil
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
		Schema:           contract.SchemaID("workflow"),
		ID:               wf.ID,
		Label:            wf.Label,
		Description:      wf.Description,
		Steps:            stepsFromNodes(wf.Nodes),
		Edges:            wf.Edges,
		Notes:            wf.Notes,
		Attributes:       wf.Attributes,
		OfferOnRequestID: wf.OfferOnRequestID,
	}
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export workflow: %w", err)
	}
	return string(data), nil
}

// applyImportedExtras applies an imported export's Attributes and Notes
// once wf already exists with its Nodes/Edges -- shared by
// ImportWorkflow's two create paths (id-preserving and fresh-id), since
// both need the identical "apply each if present" sequence.
func (c *CompositionService) applyImportedExtras(wf composition.Workflow, in exportedWorkflow) (composition.Workflow, error) {
	var err error
	if len(in.Attributes) > 0 {
		if wf, err = c.UpdateAttributes(wf.ID, in.Attributes); err != nil {
			return composition.Workflow{}, err
		}
	}
	if len(in.Notes) > 0 {
		if wf, err = c.UpdateNotes(wf.ID, in.Notes); err != nil {
			return composition.Workflow{}, err
		}
	}
	if in.offerKeyPresent {
		if wf, err = c.SetWorkflowOffer(wf.ID, in.OfferOnRequestID); err != nil {
			return composition.Workflow{}, err
		}
	}
	return wf, nil
}

// ImportWorkflow parses jsonData (ExportWorkflow's own output, or a
// hand-authored file in the same shape) and applies ADR-0036 decision
// 3's uniform import rule: no id -> create fresh (delegates to
// CreateWorkflow, held to exactly the same validation bar as a
// hand-composed workflow, no import-specific leniency); an id unknown
// here -> create preserving that id; an id matching a local workflow ->
// update through the same snapshot-then-replace chokepoint MCP's
// update_workflow tool uses. Attributes/Notes apply as a second step
// (applyImportedExtras) on the create paths, matching the existing
// compose-then-configure flow every hand-composed workflow already
// goes through (Configure's Attributes tab, the canvas's own notes).
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
		wf, err := c.createWorkflowWithID(in.ID, in.Label, in.Description, nodesFromSteps(in.Steps), in.Edges)
		if err != nil {
			return composition.Workflow{}, err
		}
		return c.applyImportedExtras(wf, in)
	}

	wf, err := c.CreateWorkflow(in.Label, in.Description, nodesFromSteps(in.Steps), in.Edges)
	if err != nil {
		return composition.Workflow{}, err
	}
	return c.applyImportedExtras(wf, in)
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
// ResolveNodeDefaults); attributes/notes update alongside when the
// field is explicitly present (nil means "the source document never
// declared this field," not "clear it" -- an older export with no
// "notes" key must never wipe an existing workflow's notes).
func (c *CompositionService) UpdateWorkflowFromExport(id, jsonData string) (composition.Workflow, error) {
	var in exportedWorkflow
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return composition.Workflow{}, fmt.Errorf("update workflow: invalid JSON: %w", err)
	}
	wf, err := c.UpdateWorkflow(id, in.Label, in.Description, nodesFromSteps(in.Steps), in.Edges)
	if err != nil {
		return composition.Workflow{}, err
	}
	if in.Attributes != nil {
		if wf, err = c.UpdateAttributes(id, in.Attributes); err != nil {
			return composition.Workflow{}, err
		}
	}
	if in.Notes != nil {
		if wf, err = c.UpdateNotes(id, in.Notes); err != nil {
			return composition.Workflow{}, err
		}
	}
	// Same present-key semantics as attributes/notes: an older export
	// with no offer key never wipes an existing declaration; a document
	// that carries the key (empty included) sets it.
	if in.offerKeyPresent {
		if wf, err = c.SetWorkflowOffer(id, in.OfferOnRequestID); err != nil {
			return composition.Workflow{}, err
		}
	}
	return wf, nil
}
