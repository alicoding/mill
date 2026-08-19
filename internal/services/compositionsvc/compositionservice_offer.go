package compositionsvc

import (
	"github.com/alicoding/mill/internal/domain/composition"
)

// SetWorkflowOffer declares (or clears, with requestID "") the
// Integration whose recognized cards offer this workflow as an action
// (goal 0126, Workflow.OfferOnRequestID's own doc comment). A
// dedicated setter rather than a wider UpdateWorkflow signature: the
// offer is workflow metadata edited independently of the graph, routed
// through the mutateWorkflow choke point (UpdatedAt/Seed.Touch/
// persist/emit all inherited).
func (c *CompositionService) SetWorkflowOffer(workflowID, requestID string) (composition.Workflow, error) {
	return c.mutateWorkflow(workflowID, func(wf composition.Workflow) (composition.Workflow, error) {
		wf.OfferOnRequestID = requestID
		return wf, nil
	})
}

// OfferedWorkflow is one workflow declared for an Integration's
// recognized cards -- the projection AtlasService's recognition seam
// consumes (id + label are all the offer menu renders).
type OfferedWorkflow struct {
	ID    string
	Label string
}

// WorkflowsOfferingRequest lists workflows declaring requestID as
// their offer target. Exported for main.go wiring into AtlasService's
// recognition seam -- not a frontend RPC (the card page asks
// AtlasService, which joins this with the host match).
//
//wails:ignore
func (c *CompositionService) WorkflowsOfferingRequest(requestID string) []OfferedWorkflow {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []OfferedWorkflow
	for _, wf := range c.user {
		if wf.OfferOnRequestID == requestID {
			out = append(out, OfferedWorkflow{ID: wf.ID, Label: wf.Label})
		}
	}
	return out
}
