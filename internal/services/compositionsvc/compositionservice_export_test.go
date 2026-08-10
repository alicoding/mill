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
// single-Capture-node fixture, which is now exactly the owner's own
// unsaveable repro (docs/adr/0028's Context section).
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

func TestImportWorkflow_GeneratesANewID_NeverReusesTheOriginal(t *testing.T) {
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

	if imported.ID == created.ID {
		t.Errorf("ImportWorkflow reused the original ID %q -- should always mint a new one (ADR-0013's Duplicate precedent)", created.ID)
	}
	if len(comp.Workflows()) != 2 {
		t.Errorf("Workflows() has %d entries, want 2 (the original plus the import, not an overwrite)", len(comp.Workflows()))
	}
}

func TestImportWorkflow_TwiceFromTheSameFile_CreatesTwoIndependentWorkflows(t *testing.T) {
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

	if first.ID == second.ID {
		t.Errorf("two imports of the same file produced the same ID %q -- each import must be independent, never a silent update", first.ID)
	}
	if len(comp.Workflows()) != 3 {
		t.Errorf("Workflows() has %d entries, want 3 (original + two independent imports)", len(comp.Workflows()))
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

func TestExportWorkflow_OmitsIDAndBuiltInFromTheWireShape(t *testing.T) {
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
	if _, ok := raw["id"]; ok {
		t.Error("exported JSON carries an id field -- it should be omitted, ImportWorkflow always mints a new one")
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
	if _, err := comp.ImportWorkflow(`{"label":"","nodes":[{"nodeTypeID":"capture-clipboard-html"}]}`); err == nil {
		t.Error("ImportWorkflow with an empty label returned nil error, want one (matches CreateWorkflow's own validation)")
	}
}

func TestImportWorkflow_InvalidGraphShape_Rejected(t *testing.T) {
	comp := newTestCompositionService(t)
	// Two roots (two nodes, no edge joining them) is rejected by
	// ValidateGraph -- confirms ImportWorkflow holds an imported file to
	// exactly the same bar as a hand-composed workflow, not a weaker one.
	badJSON := `{"label":"bad","nodes":[{"nodeTypeID":"trigger-manual"},{"nodeTypeID":"trigger-manual"}]}`
	if _, err := comp.ImportWorkflow(badJSON); err == nil {
		t.Error("ImportWorkflow with two root nodes returned nil error, want ValidateGraph's rejection")
	} else if !strings.Contains(err.Error(), "") {
		// Any error is acceptable here; the point is that it's rejected,
		// not the exact message (which belongs to ValidateGraph, not this file).
		_ = err
	}
}

func TestImportWorkflow_AppliesAttributes(t *testing.T) {
	comp := newTestCompositionService(t)
	exported := `{
		"label": "with attributes",
		"nodes": [{"id": "t", "nodeTypeID": "trigger-manual"}, {"id": "c", "nodeTypeID": "capture-clipboard-html"}],
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
