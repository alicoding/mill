package executionsvc

import (
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// The step-test surface (ADR-0051 §5): run ONE step on a chosen input
// and show what comes out, without running the workflow. The step runs
// through the SAME registered exec a real run calls (composition.
// ExecuteNodeAlone), on the workflow's attribute defaults, after the
// SAME guardrail evaluation a real run applies -- with one difference:
// there is no run to park, so an ask or deny verdict REFUSES the test
// and says why, rather than performing a guarded side effect nobody
// approved. The node arrives by value (type id + config), so a step on
// an unsaved canvas can be tried too; WorkflowID/NodeID only scope the
// guardrail rules that name them.

// StepTestRequest is one "run this step on…" call.
type StepTestRequest struct {
	WorkflowID string            `json:"workflowId"`
	NodeID     string            `json:"nodeId"`
	NodeTypeID string            `json:"nodeTypeId"`
	Config     map[string]string `json:"config"`
	Payload    string            `json:"payload"`
	// Attributes overrides the workflow's attribute defaults when
	// non-nil (a "last run's input" replay passes the recorded bag).
	Attributes map[string]any `json:"attributes"`
}

// StepTestResult is what came out -- or why nothing ran.
type StepTestResult struct {
	Output           string         `json:"output"`
	OutputAttributes map[string]any `json:"outputAttributes"`
	// Error is the step's own failure text (the step ran and failed).
	Error string `json:"error"`
	// Refused is set when the guardrail would not let this step run
	// unattended; RefusedEffect/RefusedRule carry the verdict.
	Refused       bool   `json:"refused"`
	RefusedEffect string `json:"refusedEffect"`
	RefusedRule   string `json:"refusedRule"`
}

// TestStep runs req's step alone. Only a malformed request errors; a
// step failure or a guardrail refusal is a normal result.
func (e *ExecutionService) TestStep(req StepTestRequest) (StepTestResult, error) {
	node := composition.Node{ID: req.NodeID, NodeTypeID: req.NodeTypeID, Config: req.Config}
	if nt, ok := composition.LookupNodeType(req.NodeTypeID); ok {
		node.Kind = nt.Kind
	}
	var attrs []composition.AttributeDef
	if wf, ok := e.findWorkflow(req.WorkflowID); ok {
		attrs = wf.Attributes
	}
	ec := composition.ExecContext{Payload: req.Payload, Attributes: req.Attributes, WorkflowID: req.WorkflowID}
	if ec.Attributes == nil {
		ec.Attributes = composition.AttributeDefaults(attrs)
	}
	if e.guard != nil {
		v := e.evaluateVerdict(req.WorkflowID, node, ec, composition.EffectForNode(node))
		if v.Effect != guardrail.EffectAllow {
			return StepTestResult{Refused: true, RefusedEffect: string(v.Effect), RefusedRule: v.RuleLabel}, nil
		}
	}
	out, err := composition.ExecuteNodeAlone(node, attrs, ec)
	if err != nil {
		return StepTestResult{Error: err.Error()}, nil
	}
	return StepTestResult{Output: out.Payload, OutputAttributes: out.Attributes}, nil
}
