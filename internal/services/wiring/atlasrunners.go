package wiring

import (
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/executionsvc"
)

// WireAtlasWorkflowRunners connects a card's referenced workflow (goal
// 0061 slice C's "Update now") and a card action (goal 0084) to
// executionService.RunWorkflow/RunWorkflowForAtlasCard, plus a run's
// completion back to atlasService -- same late-bound-setter shape as
// WireChildWorkflowRunner in main.go, atlassvc never imports
// executionsvc directly. Kind is RunKindTriggered (production
// semantics: a disabled or never-published refresh workflow is
// rejected, same requirement child-workflow nodes already hold their
// callable target to).
func WireAtlasWorkflowRunners(executionService *executionsvc.ExecutionService, atlas *atlassvc.AtlasService) {
	atlassvc.SetWorkflowRunner(func(workflowID string) (string, bool, bool, error) {
		summary, err := executionService.RunWorkflow(workflowID, executionsvc.RunKindTriggered, nil)
		if err != nil {
			return "", false, false, err
		}
		pending := summary.Pending != nil
		return summary.RunID, !pending && summary.Status == "SUCCESS", pending, nil
	})
	// Card actions: source-card-recording entry, so the cycle guard covers action runs.
	atlassvc.SetCardActionRunner(func(workflowID, sourceCardID string, values map[string]string, payload string) error {
		_, err := executionService.RunWorkflowForAtlasCard(workflowID, sourceCardID, values, payload)
		return err
	})
	executionService.SetRunCompletionSink(atlas.NotifyRunCompleted)
}
