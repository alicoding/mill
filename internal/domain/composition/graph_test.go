package composition

import (
	"testing"
)

// --- Graph-shape checks ExecuteWorkflow itself still enforces while
// walking (root existence, non-Decision out-degree, cycle detection).
// Reachability and Decision-edge validity are ValidateGraph's job now
// (a save-time concern -- see the tests further below), since a real
// execution only ever walks the one path a given ExecContext takes,
// which is no longer "every node" once branching exists. ---

func TestExecuteWorkflow_EmptyGraph_Rejected(t *testing.T) {
	if _, err := ExecuteWorkflow(nil, nil, nil); err == nil {
		t.Fatal("ExecuteWorkflow with no nodes returned nil error, want an error")
	}
}

func TestExecuteWorkflow_WrongEdgeCount_Rejected(t *testing.T) {
	nodes := []Node{
		{ID: "a", NodeTypeID: "capture-clipboard-html"},
		{ID: "b", NodeTypeID: "process-html-to-markdown"},
	}
	if _, err := ExecuteWorkflow(nodes, nil, nil); err == nil {
		t.Fatal("ExecuteWorkflow with the wrong edge count for the node count returned nil error, want an error")
	}
}

func TestExecuteWorkflow_Branching_Rejected(t *testing.T) {
	// One non-Decision node with two outgoing edges -- Decision nodes can
	// branch now (SPEC.md §3.5), but nothing else can, so this must still
	// be rejected at execution (the canvas is separately designed to
	// prevent drawing this in the first place, but the backend can't
	// trust that).
	nodes := []Node{
		{ID: "a", NodeTypeID: "capture-clipboard-html"},
		{ID: "b", NodeTypeID: "process-html-to-markdown"},
		{ID: "c", NodeTypeID: "apply-clipboard-write-text"},
	}
	edges := []Edge{
		{ID: "e1", Source: "a", Target: "b"},
		{ID: "e2", Source: "a", Target: "c"},
	}
	if _, err := ExecuteWorkflow(nodes, edges, nil); err == nil {
		t.Fatal("ExecuteWorkflow with a branching node returned nil error, want an error")
	}
}

func TestExecuteWorkflow_MultipleRootsMergingIntoOneNode_Rejected(t *testing.T) {
	// Two independent starting nodes both feeding into a single node --
	// a merge, not a branch (neither source has more than one outgoing
	// edge), so the out-degree check alone wouldn't catch this; the
	// "exactly one root" check is what does.
	nodes := []Node{
		{ID: "a", NodeTypeID: "capture-clipboard-html"},
		{ID: "b", NodeTypeID: "capture-clipboard-html"},
		{ID: "c", NodeTypeID: "process-html-to-markdown"},
	}
	edges := []Edge{
		{ID: "e1", Source: "a", Target: "c"},
		{ID: "e2", Source: "b", Target: "c"},
	}
	if _, err := ExecuteWorkflow(nodes, edges, nil); err == nil {
		t.Fatal("ExecuteWorkflow with two roots merging into one node returned nil error, want an error")
	}
}

func TestValidateGraph_DisconnectedIslandBehindACycle_Rejected(t *testing.T) {
	// The specific trap a naive "root count + edge count" check misses:
	// a 2-node cycle elsewhere in the graph "absorbs" exactly enough
	// edges that the total edge count still matches len(nodes)-1, while
	// a real chain (a -> b) sits disconnected from it, with a single
	// valid-looking root. Only a reachability walk catches this -- that
	// check now lives in ValidateGraph (a save-time concern), not
	// ExecuteWorkflow, since a real execution only ever walks the one
	// path its ExecContext takes and would happily run a -> b to
	// completion while never touching the disconnected c/d cycle at all.
	nodes := []Node{
		{ID: "a", NodeTypeID: "capture-clipboard-html"},
		{ID: "b", NodeTypeID: "process-html-to-markdown"},
		{ID: "c", NodeTypeID: "apply-clipboard-write-text"},
		{ID: "d", NodeTypeID: "apply-clipboard-write-html"},
	}
	edges := []Edge{
		{ID: "e1", Source: "a", Target: "b"},
		{ID: "e2", Source: "c", Target: "d"},
		{ID: "e3", Source: "d", Target: "c"},
	}
	if err := ValidateGraph(nodes, edges, nil); err == nil {
		t.Fatal("ValidateGraph with a disconnected cycle-plus-chain graph returned nil error, want an error")
	}
}

// --- Decision node: branching walk (ExecuteWorkflow) and save-time rule
// validation (ValidateGraph). ---

// decisionGraph builds a minimal Decision-rooted graph: decision-route ->
// (condition, non-otherwise) -> apply-clipboard-write-html,
// decision-route -> (otherwise) -> apply-clipboard-write-text. Which
// clipboard function fires (WriteHTML vs WriteText) is the test's proof
// of which branch actually ran.
func decisionGraph(condition string) ([]Node, []Edge) {
	nodes := []Node{
		{ID: "d", NodeTypeID: "decision-route"},
		{ID: "yes", NodeTypeID: "apply-clipboard-write-html"},
		{ID: "no", NodeTypeID: "apply-clipboard-write-text"},
	}
	edges := []Edge{
		{ID: "d-yes", Source: "d", Target: "yes", SourceHandle: condition},
		{ID: "d-no", Source: "d", Target: "no", SourceHandle: otherwiseHandle},
	}
	return nodes, edges
}

func TestExecuteWorkflow_Decision_RoutesToMatchingBranch(t *testing.T) {
	var wroteHTML, wroteText bool
	withFakeClipboard(t, nil,
		func(string) error { wroteHTML = true; return nil },
		func(string) error { wroteText = true; return nil },
	)

	// "urgent" is a boolean Attribute; ExecuteWorkflow seeds it at its
	// zero value (false, attributesEnv), so "urgent == false" matches --
	// exercising the real ExecuteWorkflow -> nextNode -> expression.Eval
	// path, not just nextNode in isolation.
	nodes, edges := decisionGraph("urgent == false")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	attrs := []AttributeDef{{Key: "urgent", Label: "Urgent", Type: FieldBoolean}}
	if _, err := ExecuteWorkflow(resolved, edges, attrs); err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if !wroteHTML || wroteText {
		t.Errorf("wroteHTML=%v wroteText=%v, want the matching (non-otherwise) branch to run", wroteHTML, wroteText)
	}
}

func TestExecuteWorkflow_Decision_FallsBackToOtherwise(t *testing.T) {
	var wroteHTML, wroteText bool
	withFakeClipboard(t, nil,
		func(string) error { wroteHTML = true; return nil },
		func(string) error { wroteText = true; return nil },
	)

	// "urgent" defaults to false; "urgent == true" doesn't match, so
	// execution must fall through to the otherwise edge instead.
	nodes, edges := decisionGraph("urgent == true")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	attrs := []AttributeDef{{Key: "urgent", Label: "Urgent", Type: FieldBoolean}}
	if _, err := ExecuteWorkflow(resolved, edges, attrs); err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if wroteHTML || !wroteText {
		t.Errorf("wroteHTML=%v wroteText=%v, want the otherwise branch to run", wroteHTML, wroteText)
	}
}

func TestValidateGraph_Decision_Valid_Accepted(t *testing.T) {
	nodes, edges := decisionGraph("urgent == false")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	attrs := []AttributeDef{{Key: "urgent", Label: "Urgent", Type: FieldBoolean}}
	if err := ValidateGraph(resolved, edges, attrs); err != nil {
		t.Errorf("ValidateGraph returned error for a valid decision graph: %v", err)
	}
}

func TestValidateGraph_Decision_MissingOtherwise_Rejected(t *testing.T) {
	nodes := []Node{
		{ID: "d", NodeTypeID: "decision-route"},
		{ID: "yes", NodeTypeID: "apply-clipboard-write-html"},
	}
	edges := []Edge{
		{ID: "d-yes", Source: "d", Target: "yes", SourceHandle: "urgent == false"},
	}
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	attrs := []AttributeDef{{Key: "urgent", Label: "Urgent", Type: FieldBoolean}}
	if err := ValidateGraph(resolved, edges, attrs); err == nil {
		t.Fatal("ValidateGraph with a decision node missing its otherwise edge returned nil error, want an error")
	}
}

func TestValidateGraph_Decision_InvalidExpressionSyntax_Rejected(t *testing.T) {
	nodes, edges := decisionGraph("urgent ==")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	attrs := []AttributeDef{{Key: "urgent", Label: "Urgent", Type: FieldBoolean}}
	if err := ValidateGraph(resolved, edges, attrs); err == nil {
		t.Fatal("ValidateGraph with an invalid expression returned nil error, want an error")
	}
}

func TestValidateGraph_Decision_TypeMismatch_Rejected(t *testing.T) {
	// "label" is declared as text (FieldText); comparing it with ">"
	// must fail to compile against attributesEnv's zero-valued string,
	// same as expression.TestCompile_TypeMismatch at the adapter level --
	// caught here at save time, before any run ever hits it.
	nodes, edges := decisionGraph("label > 5")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	attrs := []AttributeDef{{Key: "label", Label: "Label", Type: FieldText}}
	if err := ValidateGraph(resolved, edges, attrs); err == nil {
		t.Fatal("ValidateGraph comparing a text attribute with '>' returned nil error, want an error")
	}
}
