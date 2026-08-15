package executionsvc

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// TestGuardrail_AtlasCardCreateParks_ApproveCreatesCard is goal 0066's
// guardrail proof: apply-atlas-card-create carries guardrail.ClassLocal
// (allow by default, same as apply-file-write), so a rule explicitly
// asking for it -- exactly the shape newGuardedHarness's own
// TestGuardrail_AllowRuleSkipsApproval/DenyRuleFailsImmediately already
// use for test-external-echo -- must park the run before the card is
// created, and only create it after approval. Wires
// composition.SetAtlasCardCreator to a local fake rather than a real
// AtlasService: this test is about the guardrail gate, not atlassvc's
// own storage (already covered by internal/services/atlassvc's own
// tests).
func TestGuardrail_AtlasCardCreateParks_ApproveCreatesCard(t *testing.T) {
	var createdTitles []string
	composition.SetAtlasCardCreator(func(kindID, title string, fields map[string]string, sourceRunID string) (composition.AtlasCard, error) {
		createdTitles = append(createdTitles, title)
		return composition.AtlasCard{ID: "fake-card-1", KindID: kindID, Title: title, Fields: fields}, nil
	})
	t.Cleanup(func() {
		composition.SetAtlasCardCreator(func(kindID, title string, fields map[string]string, sourceRunID string) (composition.AtlasCard, error) {
			return composition.AtlasCard{}, nil
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

	wf, err := comp.CreateWorkflow("Guarded atlas create", "", []composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual", Position: composition.Position{X: 0, Y: 0}},
		{ID: "n1", NodeTypeID: "apply-atlas-card-create", Position: composition.Position{X: 0, Y: 120},
			Config: map[string]string{"kindId": "atlas-kind-intake", "title": "Test lead", "fieldBindings": "{}"}},
	}, []composition.Edge{{ID: "e1", Source: "t1", Target: "n1"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	if _, err := guard.CreateRule(guardrail.Rule{
		Label: "atlas writes need review", Effect: guardrail.EffectAsk, NodeTypeID: "apply-atlas-card-create",
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
	if pending.NodeID != "n1" || pending.NodeTypeID != "apply-atlas-card-create" {
		t.Fatalf("pending = %+v, want node n1 / apply-atlas-card-create", pending)
	}
	if len(createdTitles) != 0 {
		t.Fatalf("card creator called %d times before approval, want 0", len(createdTitles))
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
	if len(createdTitles) != 1 || createdTitles[0] != "Test lead" {
		t.Fatalf("card creator calls = %v, want exactly one call for %q after approval", createdTitles, "Test lead")
	}
}
