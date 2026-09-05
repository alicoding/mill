package executionsvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/execution"
)

// Goal 0066's Atlas<->Workflows integration: the trigger cycle guard's
// bookkeeping needs a card-write step to resolve its own run's id
// (CurrentRunID), a way to start a run recording which card triggered
// it (RunWorkflowForAtlasCard), and a way to resolve that back out
// later (AtlasSourceCardForRun) -- split into its own file once
// executionservice.go crossed the 500-line convention, same split-file
// reasoning executionservice_receipt.go/executionservice_systemevent.go
// already establish.

// CurrentRunID resolves ExecContext.RunContext (opaque, composition.
// SetCurrentRunIDLookup's own doc comment) into the run's own id --
// runEvidenceLookup's identical opening resolution
// (executionservice_receipt.go), split out since atlas-card-create/
// update only need the id itself, not a full assembled RunEvidence.
//
//wails:ignore
func (e *ExecutionService) CurrentRunID(runCtx any) (string, error) {
	ctx, ok := runCtx.(execution.Context)
	if !ok {
		return "", fmt.Errorf("run context is not a real execution.Context")
	}
	return ctx.GetWorkflowID()
}

// RunWorkflowForAtlasCard is RunWorkflowWithPayload plus recording
// sourceCardID as this run's own AtlasSourceCardID -- TriggerService's
// trigger-atlas-card fire path uses this instead of RunWorkflowWithPayload
// so AtlasSourceCardForRun can later resolve which card started this
// exact run, the cycle guard's bookkeeping.
//
//wails:ignore
func (e *ExecutionService) RunWorkflowForAtlasCard(workflowID, sourceCardID string, values map[string]string, payload string) (RunSummary, error) {
	return e.runWorkflowStart(workflowID, RunKindTriggered, RunOptions{Values: values, Payload: payload, AtlasSourceCardID: sourceCardID})
}

// AtlasSourceCardForRun resolves runID's own recorded AtlasSourceCardID,
// "" and false for a run not started via RunWorkflowForAtlasCard or one
// that can't be resolved. Mirrors emitSystemEvent's identical runID ->
// runInput resolution (executionservice_systemevent.go), applied to a
// specific field instead of the whole loop-rule decision -- the
// decision itself (does sourceCardID match the card just written) lives
// at triggersvc's own dispatch point, which already holds
// *ExecutionService and can call this directly.
//
//wails:ignore
func (e *ExecutionService) AtlasSourceCardForRun(runID string) (string, bool) {
	statuses, err := execution.ListWorkflows(e.ctx, execution.WithFilterWorkflowIDs(runID))
	if err != nil || len(statuses) == 0 {
		return "", false
	}
	in, ok := decodeAny[runInput](statuses[0].Input)
	if !ok {
		return "", false
	}
	return in.AtlasSourceCardID, in.AtlasSourceCardID != ""
}
