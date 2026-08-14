package executionsvc

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// Regression: a run started from the UI (canvas Run) or a trigger never
// emitted mill-data-changed{entity:"run"} -- only the MCP debug tools
// did -- so an already-open Runs panel (which stays mounted across
// section-tab switches and refreshes only on that event) showed a
// stale, possibly empty list until a full app reload. Pins both
// emission points: run start (runWorkflowStart) and run completion
// (runWorkflow, the one function every run finishes through).
func TestRunWorkflow_EmitsRunDataEventOnStartAndCompletion(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	workflowID := findBuiltInWorkflowID(t, comp, "Load sample HTML")

	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guardrailsvc.NewGuardrailService(store, comp))
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	// The start emit fires on the caller's goroutine and the completion
	// emit inside the DBOS workflow goroutine -- the capture must be
	// mutex-guarded or the race detector (rightly) fails this test.
	var mu sync.Mutex
	var runEmits []string
	dataevent.TestHook = func(entity, id string) {
		if entity == "run" {
			mu.Lock()
			runEmits = append(runEmits, id)
			mu.Unlock()
		}
	}
	t.Cleanup(func() { dataevent.TestHook = nil })

	summary, err := exec.RunWorkflow(workflowID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}

	mu.Lock()
	got := append([]string(nil), runEmits...)
	mu.Unlock()
	if len(got) < 2 {
		t.Fatalf("got %d mill-data-changed{entity:%q} emits, want at least 2 (start + completion)", len(got), "run")
	}
	for i, id := range got {
		if id != summary.RunID {
			t.Errorf("emit %d carries id %q, want the run's own id %q", i, id, summary.RunID)
		}
	}
}
