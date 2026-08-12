package composition

func init() {
	// A pure routing point -- its conditions live on its outgoing edges
	// (graph.go's ValidateGraph/nextNode), not here, so it registers with
	// exec: nil like Trigger node types. ExecuteWorkflow skips both kinds
	// structurally.
	//
	// UI vocabulary relabeled "Branch" by ADR-0027 (the code identifiers
	// KindDecision/decision-route stay -- same code-vs-UI naming split
	// ADR-0016 already established): "Decision" as a user-facing noun now
	// means the terminal outcome (decisionoutcome.go), not this routing
	// node.
	RegisterNodeType(NodeType{
		ID: "decision-route", Kind: KindDecision,
		Label:       "Branch: route",
		Output:      "payload and Attributes unchanged; routes to the matching outgoing edge",
		Description: "Routes to one of several next steps based on a rule evaluated against this workflow's Attributes. A pure routing point -- its conditions live on its outgoing edges (SPEC.md §3.5), not here.",
	}, nil)
}
