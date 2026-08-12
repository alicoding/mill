package compositionsvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// captureEmits swaps in dataevent.TestHook (dataevent.go's own doc
// comment has the full reasoning: application.Get() is always nil
// under `go test`, so this is the one seam that can observe an Emit
// call at all) and returns the slice it appends every (entity, id)
// pair to. Restored to nil on test cleanup so a later test in this
// package never sees a stale hook.
func captureEmits(t *testing.T) *[]dataevent.Changed {
	t.Helper()
	var got []dataevent.Changed
	dataevent.TestHook = func(entity, id string) {
		got = append(got, dataevent.Changed{Entity: entity, ID: id})
	}
	t.Cleanup(func() { dataevent.TestHook = nil })
	return &got
}

// TestDataEvent_WorkflowMutations proves goal 0017's P0-1: every
// direct-UI workflow mutation emits mill-data-changed{entity:"workflow"}
// -- the root-cause fix (before this, ONLY mcpsvc's MCP-authoring path
// emitted this event, so a plain Composition-page create/edit/publish
// never reached another open tab/picker).
func TestDataEvent_WorkflowMutations(t *testing.T) {
	store := servicetest.NewFakeStore()
	c := NewCompositionService(store)
	nodes := []composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}}

	t.Run("CreateWorkflow", func(t *testing.T) {
		got := captureEmits(t)
		wf, err := c.CreateWorkflow("Emit test wf", "", nodes, nil)
		if err != nil {
			t.Fatalf("CreateWorkflow: %v", err)
		}
		assertEmittedWorkflow(t, *got, wf.ID)
	})

	t.Run("UpdateWorkflow", func(t *testing.T) {
		wf, err := c.CreateWorkflow("Update-target wf", "", nodes, nil)
		if err != nil {
			t.Fatalf("CreateWorkflow: %v", err)
		}
		got := captureEmits(t)
		updated, err := c.UpdateWorkflow(wf.ID, "Update-target wf (edited)", "", nodes, nil)
		if err != nil {
			t.Fatalf("UpdateWorkflow: %v", err)
		}
		assertEmittedWorkflow(t, *got, updated.ID)
	})

	t.Run("UpdateAttributes", func(t *testing.T) {
		wf, err := c.CreateWorkflow("Attrs-target wf", "", nodes, nil)
		if err != nil {
			t.Fatalf("CreateWorkflow: %v", err)
		}
		got := captureEmits(t)
		attrs := []composition.AttributeDef{{Key: "note", Type: typedfield.TypeText}}
		updated, err := c.UpdateAttributes(wf.ID, attrs)
		if err != nil {
			t.Fatalf("UpdateAttributes: %v", err)
		}
		assertEmittedWorkflow(t, *got, updated.ID)
	})

	t.Run("PublishWorkflow_PublishExistingVersion_SetWorkflowDisabled_RestoreVersionToDraft", func(t *testing.T) {
		// All four route through the shared mutateWorkflow choke point
		// (compositionservice_versioning.go) -- one emit call there
		// covers every one of them; exercised together here for that
		// reason, one call each.
		wf, err := c.CreateWorkflow("Lifecycle-target wf", "", nodes, nil)
		if err != nil {
			t.Fatalf("CreateWorkflow: %v", err)
		}

		got := captureEmits(t)
		if _, err := c.PublishWorkflow(wf.ID); err != nil {
			t.Fatalf("PublishWorkflow: %v", err)
		}
		assertEmittedWorkflow(t, *got, wf.ID)

		got = captureEmits(t)
		if _, err := c.SetWorkflowDisabled(wf.ID, true); err != nil {
			t.Fatalf("SetWorkflowDisabled: %v", err)
		}
		assertEmittedWorkflow(t, *got, wf.ID)

		got = captureEmits(t)
		if _, err := c.PublishExistingVersion(wf.ID, 1); err != nil {
			t.Fatalf("PublishExistingVersion: %v", err)
		}
		assertEmittedWorkflow(t, *got, wf.ID)

		got = captureEmits(t)
		if _, err := c.RestoreVersionToDraft(wf.ID, 1); err != nil {
			t.Fatalf("RestoreVersionToDraft: %v", err)
		}
		assertEmittedWorkflow(t, *got, wf.ID)
	})

	t.Run("DeleteWorkflow", func(t *testing.T) {
		wf, err := c.CreateWorkflow("Delete-target wf", "", nodes, nil)
		if err != nil {
			t.Fatalf("CreateWorkflow: %v", err)
		}
		got := captureEmits(t)
		if err := c.DeleteWorkflow(wf.ID); err != nil {
			t.Fatalf("DeleteWorkflow: %v", err)
		}
		assertEmittedWorkflow(t, *got, wf.ID)
	})

	t.Run("ImportWorkflow_delegatesToCreate", func(t *testing.T) {
		source, err := c.CreateWorkflow("Export-source wf", "", nodes, nil)
		if err != nil {
			t.Fatalf("CreateWorkflow: %v", err)
		}
		exported, err := c.ExportWorkflow(source.ID)
		if err != nil {
			t.Fatalf("ExportWorkflow: %v", err)
		}
		got := captureEmits(t)
		imported, err := c.ImportWorkflow(exported)
		if err != nil {
			t.Fatalf("ImportWorkflow: %v", err)
		}
		assertEmittedWorkflow(t, *got, imported.ID)
	})
}

// assertEmittedWorkflow fails the test unless got contains at least
// one dataevent.Changed{"workflow", id} pair -- every mutation this
// file tests emits the "workflow" entity, so entity itself isn't a
// parameter (unlike configuresvc's/guardrailsvc's own dataevent
// tests, which cover several different entity strings).
func assertEmittedWorkflow(t *testing.T, got []dataevent.Changed, id string) {
	t.Helper()
	for _, c := range got {
		if c.Entity == "workflow" && c.ID == id {
			return
		}
	}
	t.Errorf("dataevent.Emit(\"workflow\", %q) was not observed; got %+v", id, got)
}
