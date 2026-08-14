package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// The evidence-receipt seed (goal 0052 slice 3, ADR-0036) -- split into
// its own file for the same "split along a real seam" reason
// builtinworkflows_capturefloor.go/builtinworkflows_list.go/
// builtinworkflows_ai.go already are.

// runReceiptWorkflow injects a fixed line, renders THIS run's own
// evidence-so-far (its one prior step, this workflow's id/version/kind,
// and the running build) as JSON, then writes that receipt to the
// clipboard -- the ADR-0035 shape this goal locks in: a receipt is a
// PROCESS step composed with an existing Apply node, never a bespoke
// send path.
func runReceiptWorkflow() Workflow {
	const (
		triggerID = "example-runreceipt-trigger"
		injectID  = "example-runreceipt-inject"
		receiptID = "example-runreceipt-receipt"
		applyID   = "example-runreceipt-apply"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: injectID, NodeTypeID: "process-inject-text", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"text": "hello from mill", "placement": "append"}},
		{ID: receiptID, NodeTypeID: "process-run-receipt", Position: Position{X: 0, Y: 200}},
		{ID: applyID, NodeTypeID: "apply-clipboard-write-text", Position: Position{X: 0, Y: 300}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return Workflow{
		ID:          "example-run-receipt-workflow",
		Label:       "Example: Run receipt",
		Description: "Injects a fixed line, then renders this run's own recorded evidence -- its steps so far, their guardrail verdicts, and which Mill build ran them -- as a JSON receipt, written to the clipboard. The portable proof of a run an external agent can read.",
		Nodes:       nodes,
		Edges: []Edge{
			{ID: "example-runreceipt-e0", Source: triggerID, Target: injectID},
			{ID: "example-runreceipt-e1", Source: injectID, Target: receiptID},
			{ID: "example-runreceipt-e2", Source: receiptID, Target: applyID},
		},
		BuiltIn: true,
		Seed:    seedorigin.Stamp(1),
	}
}

// builtInReceiptWorkflows is the append-point BuiltInWorkflows() calls,
// same shape as builtInListWorkflows/builtInAIWorkflows/
// builtInSystemEventWorkflows.
func builtInReceiptWorkflows() []Workflow {
	return []Workflow{runReceiptWorkflow()}
}
