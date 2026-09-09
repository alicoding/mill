package compositionsvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// DeleteWorkflow joins the app's ONE actor-scoped undo journal (goal
// 0404 S1): undo restores the record whole -- nodes, edges, attributes
// -- and redo deletes again through the same door, mirroring the
// Configure-entity family's own round trip
// (configureentityundo_test.go's TestConfigureEntityUndo_*).
func TestDeleteWorkflow_UndoRestoresNodesEdgesAttributes(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)
	atlas := atlassvc.NewAtlasService(store)
	c.WireUndoJournal(atlas.RecordExternalUndo)

	wf, err := c.CreateWorkflow("Undo test", "", []composition.Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "m", NodeTypeID: "mcp-tool-call", Config: map[string]string{"mcpServerId": "svr-1"}},
	}, []composition.Edge{{ID: "e1", Source: "t", Target: "m"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	if _, err := c.UpdateAttributes(wf.ID, []composition.AttributeDef{
		{Key: "priority", Label: "Priority", Type: "text"},
	}); err != nil {
		t.Fatalf("UpdateAttributes: %v", err)
	}

	if err := c.DeleteWorkflow(wf.ID); err != nil {
		t.Fatalf("DeleteWorkflow: %v", err)
	}
	if findWorkflow(c, wf.ID) != nil {
		t.Fatal("workflow still present right after DeleteWorkflow")
	}
	if atlas.UndoState().TopKind != "workflow" || atlas.UndoState().TopID != wf.ID {
		t.Errorf("UndoState top = %s/%s, want workflow/%s", atlas.UndoState().TopKind, atlas.UndoState().TopID, wf.ID)
	}

	if res := atlas.Undo(); !res.Applied || res.Skipped {
		t.Fatalf("Undo = %+v, want applied and not skipped", res)
	}
	restored := findWorkflow(c, wf.ID)
	if restored == nil {
		t.Fatal("workflow missing after undo")
	}
	if len(restored.Nodes) != 2 || len(restored.Edges) != 1 {
		t.Errorf("restored nodes/edges = %d/%d, want 2/1", len(restored.Nodes), len(restored.Edges))
	}
	if len(restored.Attributes) != 1 || restored.Attributes[0].Key != "priority" {
		t.Errorf("restored attributes = %+v, want the priority attribute back", restored.Attributes)
	}

	if res := atlas.Redo(); !res.Applied || res.Skipped {
		t.Fatalf("Redo = %+v, want applied and not skipped", res)
	}
	if findWorkflow(c, wf.ID) != nil {
		t.Error("workflow present after redo -- redo did not re-delete")
	}
}

// Two workflow deletes made inside one BeginUndoMark/EndUndoMark
// (shared/bulkDeleteWithUndo.ts's own wrap) join ONE mark: a single
// Undo restores both, the same bulk-mark contract the Configure-entity
// family already proves (listGridCommands.ts's deleteRows).
func TestDeleteWorkflow_BulkMarkUndoesBothWithOneUndo(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)
	atlas := atlassvc.NewAtlasService(store)
	c.WireUndoJournal(atlas.RecordExternalUndo)

	wf1, err := c.CreateWorkflow("First", "", []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}}, nil)
	if err != nil {
		t.Fatalf("CreateWorkflow first: %v", err)
	}
	wf2, err := c.CreateWorkflow("Second", "", []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}}, nil)
	if err != nil {
		t.Fatalf("CreateWorkflow second: %v", err)
	}

	atlas.BeginUndoMark()
	if err := c.DeleteWorkflow(wf1.ID); err != nil {
		t.Fatalf("DeleteWorkflow first: %v", err)
	}
	if err := c.DeleteWorkflow(wf2.ID); err != nil {
		t.Fatalf("DeleteWorkflow second: %v", err)
	}
	atlas.EndUndoMark()

	if findWorkflow(c, wf1.ID) != nil || findWorkflow(c, wf2.ID) != nil {
		t.Fatal("both workflows should be gone right after the bulk delete")
	}

	if res := atlas.Undo(); !res.Applied || res.Skipped {
		t.Fatalf("Undo = %+v, want applied and not skipped", res)
	}
	if findWorkflow(c, wf1.ID) == nil || findWorkflow(c, wf2.ID) == nil {
		t.Error("one ⌘Z should restore both workflows -- the bulk mark holds two entries")
	}
	if atlas.UndoState().HasUndo {
		t.Error("a second undo step survived the bulk mark -- want exactly one mark for both deletes")
	}
}

func findWorkflow(c *CompositionService, id string) *composition.Workflow {
	for _, wf := range c.Workflows() {
		if wf.ID == id {
			return &wf
		}
	}
	return nil
}
