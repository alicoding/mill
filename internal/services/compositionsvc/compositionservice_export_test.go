package compositionsvc

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// newTestCompositionService starts from a genuinely empty workflow list,
// not the seeded built-ins -- mirrors newTestConfigureService's own
// documented reasoning (configureservice_test.go): NewCompositionService's
// restore() seeds BuiltInWorkflows() on any fresh store, and every
// workflow (seeded or user-composed) lives in the same c.user slice
// (SPEC.md §3.3's Update: "no built-in special case"), so every
// count-based assertion in this file would otherwise see 2 unexpected
// entries.
func newTestCompositionService(t *testing.T) *CompositionService {
	t.Helper()
	comp := NewCompositionService(servicetest.NewFakeStore())
	comp.user = nil
	return comp
}

// triggerAndCaptureNodes is a minimal, real, Trigger-rooted two-node
// graph (docs/adr/0028: a non-Trigger root is now a save-time Error) --
// used by every export/import fixture below in place of the old
// single-Capture-node fixture, which is now unsaveable
// (docs/adr/0028's Context section).
func triggerAndCaptureNodes() ([]composition.Node, []composition.Edge) {
	nodes := []composition.Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "c", NodeTypeID: "capture-clipboard-html"},
	}
	edges := []composition.Edge{{ID: "e1", Source: "t", Target: "c"}}
	return nodes, edges
}

func TestExportWorkflow_RoundTripsThroughImport(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes, edges := triggerAndCaptureNodes()
	created, err := comp.CreateWorkflow("My workflow", "a description", nodes, edges)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	exported, err := comp.ExportWorkflow(created.ID)
	if err != nil {
		t.Fatalf("ExportWorkflow: %v", err)
	}

	imported, err := comp.ImportWorkflow(exported)
	if err != nil {
		t.Fatalf("ImportWorkflow: %v", err)
	}

	if imported.Label != created.Label {
		t.Errorf("imported.Label = %q, want %q", imported.Label, created.Label)
	}
	if imported.Description != created.Description {
		t.Errorf("imported.Description = %q, want %q", imported.Description, created.Description)
	}
	if len(imported.Nodes) != len(created.Nodes) {
		t.Fatalf("imported has %d nodes, want %d", len(imported.Nodes), len(created.Nodes))
	}
	if imported.Nodes[0].NodeTypeID != created.Nodes[0].NodeTypeID {
		t.Errorf("imported.Nodes[0].NodeTypeID = %q, want %q", imported.Nodes[0].NodeTypeID, created.Nodes[0].NodeTypeID)
	}
}

// TestImportWorkflow_KnownID_UpdatesInPlace pins ADR-0036 decision 3:
// an export now carries the source workflow's real id, so importing it
// back into the same instance (id matches a local workflow) updates
// that workflow rather than creating a duplicate -- the two-machine
// bridge write-back this ADR exists for.
func TestImportWorkflow_KnownID_UpdatesInPlace(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes, edges := triggerAndCaptureNodes()
	created, err := comp.CreateWorkflow("My workflow", "", nodes, edges)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	exported, err := comp.ExportWorkflow(created.ID)
	if err != nil {
		t.Fatalf("ExportWorkflow: %v", err)
	}

	imported, err := comp.ImportWorkflow(exported)
	if err != nil {
		t.Fatalf("ImportWorkflow: %v", err)
	}

	if imported.ID != created.ID {
		t.Errorf("ImportWorkflow minted a new ID %q for a known id %q -- should update in place", imported.ID, created.ID)
	}
	if len(comp.Workflows()) != 1 {
		t.Errorf("Workflows() has %d entries, want 1 (updated in place, not duplicated)", len(comp.Workflows()))
	}
}

// TestImportWorkflow_TwiceFromTheSameFile_StaysOneWorkflow extends the
// same rule: re-importing an unchanged export repeatedly is idempotent
// (every import matches the same id), never accumulates duplicates.
func TestImportWorkflow_TwiceFromTheSameFile_StaysOneWorkflow(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes, edges := triggerAndCaptureNodes()
	created, err := comp.CreateWorkflow("My workflow", "", nodes, edges)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	exported, err := comp.ExportWorkflow(created.ID)
	if err != nil {
		t.Fatalf("ExportWorkflow: %v", err)
	}

	first, err := comp.ImportWorkflow(exported)
	if err != nil {
		t.Fatalf("first ImportWorkflow: %v", err)
	}
	second, err := comp.ImportWorkflow(exported)
	if err != nil {
		t.Fatalf("second ImportWorkflow: %v", err)
	}

	if first.ID != second.ID || first.ID != created.ID {
		t.Errorf("repeated imports of the same file produced different ids (%q, %q, source %q) -- should all resolve to the same workflow", first.ID, second.ID, created.ID)
	}
	if len(comp.Workflows()) != 1 {
		t.Errorf("Workflows() has %d entries, want 1", len(comp.Workflows()))
	}
}

// TestImportWorkflow_UnknownID_CreatesPreservingIt is the other half of
// decision 3: an id this instance has never seen creates a NEW
// workflow at that exact id, so a far-side agent that edits an export
// and writes it back to a fresh Mill instance keeps one stable logical
// identity across the bridge, rather than silently getting a random id.
func TestImportWorkflow_UnknownID_CreatesPreservingIt(t *testing.T) {
	comp := newTestCompositionService(t)
	exported := `{
		"id": "workflow-from-elsewhere",
		"label": "from elsewhere",
		"steps": [{"id": "t", "StepTypeID": "trigger-manual"}, {"id": "c", "StepTypeID": "capture-clipboard-html"}],
		"edges": [{"id": "e1", "source": "t", "target": "c"}]
	}`

	imported, err := comp.ImportWorkflow(exported)
	if err != nil {
		t.Fatalf("ImportWorkflow: %v", err)
	}
	if imported.ID != "workflow-from-elsewhere" {
		t.Errorf("ImportWorkflow.ID = %q, want the preserved id %q", imported.ID, "workflow-from-elsewhere")
	}
	if len(comp.Workflows()) != 1 {
		t.Errorf("Workflows() has %d entries, want 1", len(comp.Workflows()))
	}
}

// TestImportWorkflow_NoID_MintsAFreshOne is decision 3's third case: a
// payload with no id at all (a hand-authored file, or any export
// written before ADR-0036) still creates with a freshly minted id --
// today's ImportWorkflow behavior, unchanged.
func TestImportWorkflow_NoID_MintsAFreshOne(t *testing.T) {
	comp := newTestCompositionService(t)
	exported := `{
		"label": "no id at all",
		"steps": [{"id": "t", "StepTypeID": "trigger-manual"}, {"id": "c", "StepTypeID": "capture-clipboard-html"}],
		"edges": [{"id": "e1", "source": "t", "target": "c"}]
	}`

	first, err := comp.ImportWorkflow(exported)
	if err != nil {
		t.Fatalf("first ImportWorkflow: %v", err)
	}
	second, err := comp.ImportWorkflow(exported)
	if err != nil {
		t.Fatalf("second ImportWorkflow: %v", err)
	}
	if first.ID == "" || second.ID == "" || first.ID == second.ID {
		t.Errorf("two id-less imports got ids (%q, %q) -- want two distinct, freshly minted ids", first.ID, second.ID)
	}
	if len(comp.Workflows()) != 2 {
		t.Errorf("Workflows() has %d entries, want 2", len(comp.Workflows()))
	}
}

// TestImportWorkflow_LegacyNodesKey_ImportsIdentically pins
// docs/goals/0053 tier 2's backward-compatibility promise: a document
// using the pre-rename "nodes"/"NodeTypeID" wire vocabulary -- every
// workflow export ever produced before this change -- imports to the
// exact same result as the current "steps"/"StepTypeID" vocabulary,
// forever.
func TestImportWorkflow_LegacyNodesKey_ImportsIdentically(t *testing.T) {
	legacy := `{
		"label": "legacy vocabulary",
		"description": "pre-0053 export",
		"nodes": [{"id": "t", "NodeTypeID": "trigger-manual"}, {"id": "c", "NodeTypeID": "capture-clipboard-html"}],
		"edges": [{"id": "e1", "source": "t", "target": "c"}]
	}`
	current := `{
		"label": "legacy vocabulary",
		"description": "pre-0053 export",
		"steps": [{"id": "t", "StepTypeID": "trigger-manual"}, {"id": "c", "StepTypeID": "capture-clipboard-html"}],
		"edges": [{"id": "e1", "source": "t", "target": "c"}]
	}`

	compLegacy := newTestCompositionService(t)
	fromLegacy, err := compLegacy.ImportWorkflow(legacy)
	if err != nil {
		t.Fatalf("ImportWorkflow(legacy \"nodes\" vocabulary): %v", err)
	}

	compCurrent := newTestCompositionService(t)
	fromCurrent, err := compCurrent.ImportWorkflow(current)
	if err != nil {
		t.Fatalf("ImportWorkflow(current \"steps\" vocabulary): %v", err)
	}

	if fromLegacy.Label != fromCurrent.Label || fromLegacy.Description != fromCurrent.Description {
		t.Errorf("legacy import = %+v, current import = %+v, want matching Label/Description", fromLegacy, fromCurrent)
	}
	if len(fromLegacy.Nodes) != len(fromCurrent.Nodes) {
		t.Fatalf("legacy import has %d nodes, current has %d, want equal", len(fromLegacy.Nodes), len(fromCurrent.Nodes))
	}
	for i := range fromLegacy.Nodes {
		if fromLegacy.Nodes[i].NodeTypeID != fromCurrent.Nodes[i].NodeTypeID {
			t.Errorf("node[%d].NodeTypeID: legacy = %q, current = %q, want equal", i, fromLegacy.Nodes[i].NodeTypeID, fromCurrent.Nodes[i].NodeTypeID)
		}
	}
	if len(fromLegacy.Edges) != len(fromCurrent.Edges) {
		t.Errorf("legacy import has %d edges, current has %d, want equal", len(fromLegacy.Edges), len(fromCurrent.Edges))
	}
}

func TestExportWorkflow_IsDeterministic_RepeatedExportsAreByteIdentical(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes, edges := triggerAndCaptureNodes()
	created, err := comp.CreateWorkflow("My workflow", "a description", nodes, edges)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	first, err := comp.ExportWorkflow(created.ID)
	if err != nil {
		t.Fatalf("first ExportWorkflow: %v", err)
	}
	second, err := comp.ExportWorkflow(created.ID)
	if err != nil {
		t.Fatalf("second ExportWorkflow: %v", err)
	}

	if first != second {
		t.Errorf("two exports of an unchanged workflow produced different output -- this is exactly the git-diff-noise problem the design is meant to avoid.\nfirst:\n%s\nsecond:\n%s", first, second)
	}
}

// TestExportWorkflow_CarriesIDAndSchemaOmitsBuiltIn pins ADR-0036
// decision 3 (export always emits the real id) and decision 2 (the
// envelope's schema field) together, alongside the still-true absence
// of builtIn from the wire shape.
func TestExportWorkflow_CarriesIDAndSchemaOmitsBuiltIn(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes, edges := triggerAndCaptureNodes()
	created, err := comp.CreateWorkflow("My workflow", "", nodes, edges)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	exported, err := comp.ExportWorkflow(created.ID)
	if err != nil {
		t.Fatalf("ExportWorkflow: %v", err)
	}

	var raw map[string]any
	if err := json.Unmarshal([]byte(exported), &raw); err != nil {
		t.Fatalf("exported output is not valid JSON: %v", err)
	}
	if got, _ := raw["id"].(string); got != created.ID {
		t.Errorf("exported id = %q, want %q", got, created.ID)
	}
	if got, _ := raw["schema"].(string); got != "mill://schema/workflow/v1" {
		t.Errorf("exported schema = %q, want %q", got, "mill://schema/workflow/v1")
	}
	if _, ok := raw["builtIn"]; ok {
		t.Error("exported JSON carries a builtIn field -- it should be omitted, an imported workflow is never a protected built-in")
	}
}

func TestExportWorkflow_UnknownID_Rejected(t *testing.T) {
	comp := newTestCompositionService(t)
	if _, err := comp.ExportWorkflow("does-not-exist"); err == nil {
		t.Error("ExportWorkflow(unknown id) returned nil error, want one")
	}
}

func TestImportWorkflow_InvalidJSON_Rejected(t *testing.T) {
	comp := newTestCompositionService(t)
	if _, err := comp.ImportWorkflow("not json"); err == nil {
		t.Error("ImportWorkflow(invalid JSON) returned nil error, want one")
	}
}

func TestImportWorkflow_EmptyLabel_Rejected(t *testing.T) {
	comp := newTestCompositionService(t)
	if _, err := comp.ImportWorkflow(`{"label":"","steps":[{"StepTypeID":"capture-clipboard-html"}]}`); err == nil {
		t.Error("ImportWorkflow with an empty label returned nil error, want one (matches CreateWorkflow's own validation)")
	}
}

func TestImportWorkflow_InvalidGraphShape_Rejected(t *testing.T) {
	comp := newTestCompositionService(t)
	// Two roots (two nodes, no edge joining them) is rejected by
	// ValidateGraph -- confirms ImportWorkflow holds an imported file to
	// exactly the same bar as a hand-composed workflow, not a weaker one.
	badJSON := `{"label":"bad","steps":[{"StepTypeID":"trigger-manual"},{"StepTypeID":"trigger-manual"}]}`
	if _, err := comp.ImportWorkflow(badJSON); err == nil {
		t.Error("ImportWorkflow with two root nodes returned nil error, want ValidateGraph's rejection")
	} else if !strings.Contains(err.Error(), "") {
		// Any error is acceptable here; the point is that it's rejected,
		// not the exact message (which belongs to ValidateGraph, not this file).
		_ = err
	}
}

// TestNotes_RoundTripThroughSaveExportImport pins the goal 0055
// acceptance predicate directly: create -> save (UpdateNotes) -> export
// -> import -> the imported workflow's Notes equal what was saved.
func TestNotes_RoundTripThroughSaveExportImport(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes, edges := triggerAndCaptureNodes()
	created, err := comp.CreateWorkflow("Notes wf", "", nodes, edges)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	notes := []composition.Note{{
		ID:       "note-1",
		Text:     "documents the trigger and capture above",
		Position: composition.Position{X: 300, Y: 20},
		Size:     composition.Size{Width: 240, Height: 120},
		Color:    composition.NoteColorBlue,
	}}
	saved, err := comp.UpdateNotes(created.ID, notes)
	if err != nil {
		t.Fatalf("UpdateNotes: %v", err)
	}
	if len(saved.Notes) != 1 {
		t.Fatalf("UpdateNotes returned %d notes, want 1", len(saved.Notes))
	}

	exported, err := comp.ExportWorkflow(created.ID)
	if err != nil {
		t.Fatalf("ExportWorkflow: %v", err)
	}
	if !strings.Contains(exported, `"notes"`) {
		t.Fatalf("exported JSON has no \"notes\" field:\n%s", exported)
	}

	imported, err := comp.ImportWorkflow(exported)
	if err != nil {
		t.Fatalf("ImportWorkflow: %v", err)
	}
	if len(imported.Notes) != 1 {
		t.Fatalf("imported.Notes has %d entries, want 1", len(imported.Notes))
	}
	if imported.Notes[0] != notes[0] {
		t.Errorf("imported.Notes[0] = %+v, want %+v", imported.Notes[0], notes[0])
	}
}

// TestExportWorkflow_NoNotes_OmitsNotesField pins ADR-0036 decision 2's
// additive-optional rule: a workflow with no notes exports exactly as
// it did before this field existed -- no visible "notes" key, so an
// unrelated save never churns a git-committed export.
func TestExportWorkflow_NoNotes_OmitsNotesField(t *testing.T) {
	comp := newTestCompositionService(t)
	nodes, edges := triggerAndCaptureNodes()
	created, err := comp.CreateWorkflow("No notes wf", "", nodes, edges)
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	exported, err := comp.ExportWorkflow(created.ID)
	if err != nil {
		t.Fatalf("ExportWorkflow: %v", err)
	}
	if strings.Contains(exported, `"notes"`) {
		t.Errorf("exported JSON carries a \"notes\" field for a workflow with none:\n%s", exported)
	}
}

func TestImportWorkflow_AppliesAttributes(t *testing.T) {
	comp := newTestCompositionService(t)
	exported := `{
		"label": "with attributes",
		"steps": [{"id": "t", "StepTypeID": "trigger-manual"}, {"id": "c", "StepTypeID": "capture-clipboard-html"}],
		"edges": [{"id": "e1", "source": "t", "target": "c"}],
		"attributes": [{"key": "count", "label": "Count", "type": "number"}]
	}`

	imported, err := comp.ImportWorkflow(exported)
	if err != nil {
		t.Fatalf("ImportWorkflow: %v", err)
	}
	if len(imported.Attributes) != 1 || imported.Attributes[0].Key != "count" {
		t.Errorf("imported.Attributes = %+v, want one AttributeDef with Key=count", imported.Attributes)
	}
}
