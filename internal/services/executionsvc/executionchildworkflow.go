package executionsvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/trigger"
	"github.com/google/uuid"
)

// runChildWorkflow implements composition.SetChildWorkflowRunner
// (docs/adr/0010) -- ExecutionService owns this, not composition
// itself, since it needs the real DBOS execution.Context and
// ExecutionService's own registered runWorkflow function (the same one
// every other run, durable or child, executes through).
//
// runCtx is ExecContext.RunContext, threaded through opaque by
// composition -- type-asserted back here, the one place that knows
// what it really is. A nil/wrong-typed runCtx (a child-workflow node
// somehow run outside the durable path) fails loudly rather than
// silently no-op'ing; docs/adr/0008 already made the durable path the
// only path, so this should never actually happen from the app itself,
// only matters for a stray direct composition.ExecuteWorkflow call.
func (e *ExecutionService) runChildWorkflow(runCtx any, workflowID string, attrValues map[string]string, idempotencyKey string, pinnedVersion int) (string, error) {
	dbosCtx, ok := runCtx.(execution.Context)
	if !ok {
		return "", fmt.Errorf("child-workflow: no durable run context available (not running on the durable execution path)")
	}

	wf, ok := e.findWorkflow(workflowID)
	if !ok {
		return "", fmt.Errorf("child-workflow: unknown workflow: %s", workflowID)
	}
	// A workflow is only a valid child target if it's rooted in
	// trigger-callable (docs/adr/0010) -- the picker already only lists
	// those, but a stale or hand-edited config could still point at
	// something else, so this is checked again here, not trusted from
	// the UI alone (the same draw-time/save-time/run-time-agree
	// discipline Decision's single-outgoing-edge rule already
	// established).
	nodeTypeID, _, hasRoot := trigger.ExtractTrigger(wf)
	if !hasRoot || nodeTypeID != "trigger-callable" {
		return "", fmt.Errorf("child-workflow: workflow %q is not rooted in trigger-callable, cannot be invoked as a child", wf.Label)
	}

	// ADR-0021: a child invocation executes the published snapshot (or
	// an explicitly pinned one) and is rejected on a disabled or
	// never-published child -- production semantics, same as a trigger.
	nodes, edges, attrs, version, err := composition.ResolveRunnable(wf, false, pinnedVersion)
	if err != nil {
		return "", fmt.Errorf("child-workflow: %w", err)
	}

	runID := idempotencyKey
	if runID == "" {
		runID = uuid.NewString()
	}
	handle, err := execution.RunWorkflow(dbosCtx, e.runWorkflow, runInput{
		WorkflowID: wf.ID,
		Nodes:      nodes,
		Edges:      edges,
		Attributes: attrs,
		Kind:       RunKindTriggered,
		Values:     attrValues,
		Version:    version,
	}, execution.WithWorkflowID(runID))
	if err != nil {
		return "", fmt.Errorf("start child workflow %q: %w", wf.Label, err)
	}

	result, err := handle.GetResult()
	if err != nil {
		return "", fmt.Errorf("child workflow %q failed: %w", wf.Label, err)
	}
	return result, nil
}

// WireChildWorkflowRunner registers e.runChildWorkflow with composition
// (composition.SetChildWorkflowRunner) -- called once from main.go,
// same late-bound-setter shape as TriggerService.SetExecutionService,
// since composition's package-level var must exist before any workflow
// (including one containing a child-workflow node) can run. Exported
// for main.go's cross-package wiring only, never a frontend RPC.
//
//wails:ignore
func (e *ExecutionService) WireChildWorkflowRunner() {
	composition.SetChildWorkflowRunner(e.runChildWorkflow)
}
