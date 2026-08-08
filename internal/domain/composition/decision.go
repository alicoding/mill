package composition

func init() {
	// A pure routing point -- its conditions live on its outgoing edges
	// (graph.go's ValidateGraph/nextNode), not here, so it registers with
	// exec: nil like Trigger node types. ExecuteWorkflow skips both kinds
	// structurally.
	RegisterNodeType(NodeType{
		ID: "decision-route", Kind: KindDecision,
		Label:       "Decision: route",
		Description: "Routes to one of several next steps based on a rule evaluated against this workflow's Attributes. A pure routing point -- its conditions live on its outgoing edges (SPEC.md §3.5), not here.",
	}, nil)
}
