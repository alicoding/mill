package executionsvc

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// TestGuardrail_ApplyListRowParks_ApproveWritesRow is goal 0070's
// guardrail proof, mirroring TestGuardrail_AtlasCardCreateParks_
// ApproveCreatesCard (atlascard_guardrail_test.go): apply-list-row
// carries guardrail.ClassLocal (allow by default, same as apply-file-
// write/apply-atlas-card-create), so a rule explicitly asking for it
// must park the run before the row is written, and only write it after
// approval. Wires composition.SetApplyListRow to a local fake rather
// than a real ConfigureService: this test is about the guardrail gate,
// not configuresvc's own storage (already covered by
// internal/services/configuresvc's own tests).
func TestGuardrail_ApplyListRowParks_ApproveWritesRow(t *testing.T) {
	var writtenValues []map[string]string
	composition.SetApplyListRow(func(listID, keyColumn string, values map[string]string) (list.Row, error) {
		writtenValues = append(writtenValues, values)
		return list.Row{ID: "fake-row-1", Values: values, Status: list.RowActive}, nil
	})
	t.Cleanup(func() {
		composition.SetApplyListRow(func(listID, keyColumn string, values map[string]string) (list.Row, error) {
			return list.Row{}, nil
		})
	})

	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	wf, err := comp.CreateWorkflow("Guarded list row write", "", []composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual", Position: composition.Position{X: 0, Y: 0}},
		{ID: "n1", NodeTypeID: "apply-list-row", Position: composition.Position{X: 0, Y: 120},
			Config: map[string]string{
				"listId": "example-task-tracker-list", "keyColumn": "task",
				"fieldBindings": `{"task":"Ship goal 0070","status":"In progress"}`,
			}},
	}, []composition.Edge{{ID: "e1", Source: "t1", Target: "n1"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	if _, err := guard.CreateRule(guardrail.Rule{
		Label: "list writes need review", Effect: guardrail.EffectAsk, NodeTypeID: "apply-list-row",
	}); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}

	summary, err := exec.RunWorkflow(wf.ID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	if summary.Status == "SUCCESS" || summary.Status == "ERROR" {
		t.Fatalf("run should still be in flight (parked), got status %s", summary.Status)
	}

	pending := waitFor(t, "pending approval", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})
	if pending.NodeID != "n1" || pending.NodeTypeID != "apply-list-row" {
		t.Fatalf("pending = %+v, want node n1 / apply-list-row", pending)
	}
	if len(writtenValues) != 0 {
		t.Fatalf("row writer called %d times before approval, want 0", len(writtenValues))
	}

	if err := exec.ResolveApproval(summary.RunID, "n1", true, nil, false); err != nil {
		t.Fatalf("ResolveApproval: %v", err)
	}

	waitFor(t, "run to succeed", 10*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Status != "SUCCESS" {
			return RunSummary{}, false
		}
		return s, true
	})
	if len(writtenValues) != 1 || writtenValues[0]["task"] != "Ship goal 0070" {
		t.Fatalf("row writer calls = %v, want exactly one call for task %q after approval", writtenValues, "Ship goal 0070")
	}
}
