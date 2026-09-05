package compositionsvc

import (
	"github.com/alicoding/mill/internal/domain/composition"
)

// SetWorkflowDefaultEnvironment declares (or clears, with
// environmentID "") the Environment this workflow's runs use unless a
// run picks another (goal 0306 S5, Workflow.DefaultEnvironmentID's own
// doc comment). A dedicated setter rather than a wider UpdateWorkflow
// signature, for the same reason SetWorkflowOffer is one: this is
// workflow metadata edited independently of the graph, routed through
// the mutateWorkflow choke point.
func (c *CompositionService) SetWorkflowDefaultEnvironment(workflowID, environmentID string) (composition.Workflow, error) {
	return c.mutateWorkflow(workflowID, func(wf composition.Workflow) (composition.Workflow, error) {
		wf.DefaultEnvironmentID = environmentID
		return wf, nil
	})
}
