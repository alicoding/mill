package executionsvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/google/uuid"
)

// RedriveRun forks runID from the given node's step, reusing every
// earlier step's checkpointed output instead of re-executing it --
// Mill's "fix forward" mechanism (docs/adr/0004's Update), most useful
// after correcting an HTTPRequest/List/MCP Server's Configure-page setup
// in between, since those resolve live at execution time.
func (e *ExecutionService) RedriveRun(runID, fromNodeID string) (RunSummary, error) {
	steps, err := execution.GetWorkflowSteps(e.ctx, runID)
	if err != nil {
		return RunSummary{}, fmt.Errorf("get run steps: %w", err)
	}
	var stepID uint
	found := false
	for _, s := range steps {
		if s.StepName == fromNodeID {
			stepID = uint(s.StepID)
			found = true
			break
		}
	}
	if !found {
		return RunSummary{}, fmt.Errorf("run %s has no recorded step for node %s", runID, fromNodeID)
	}

	forkedID := uuid.NewString()
	// runStartMu: see its own doc comment in executionservice.go -- a
	// fork is a third "genesis" call shape into the same shared durable
	// context.
	e.runStartMu.Lock()
	handle, err := execution.ForkWorkflow[string](e.ctx, execution.ForkWorkflowInput{
		OriginalWorkflowID: runID,
		ForkedWorkflowID:   forkedID,
		StartStep:          stepID,
	})
	e.runStartMu.Unlock()
	if err != nil {
		return RunSummary{}, fmt.Errorf("redrive: %w", err)
	}
	// The fork enters DBOS via ForkWorkflow, not runWorkflowStart, so the
	// latter's own start emit never fires for forkedID -- announce it
	// here so an open Runs panel shows the redriven run immediately
	// rather than only once it completes (runWorkflow's own completion
	// emit still covers that half).
	dataevent.Emit("run", forkedID)
	if _, err := handle.GetResult(); err != nil {
		_ = err // see RunWorkflowDurable's identical comment
	}
	return e.summaryFor(handle.GetWorkflowID())
}
