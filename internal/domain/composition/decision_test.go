package composition

import "testing"

// Decision node: branching walk (ExecuteWorkflow) and save-time rule
// validation (ValidateGraph). Split out of graph_test.go once the
// reordering-evaluation-order test (goal 0173) crossed the 500-line
// convention (CLAUDE.md) -- same package, same fixtures, just its own
// file along this real domain-concept seam.

// decisionGraph builds a minimal Trigger-rooted Decision graph:
// trigger-manual -> decision-route -> (condition, non-otherwise) ->
// apply-clipboard-write-html, decision-route -> (otherwise) ->
// apply-clipboard-write-text. Which clipboard function fires (WriteHTML
// vs WriteText) is the test's proof of which branch actually ran. A
// real Trigger root (docs/adr/0028: a non-Trigger root is a save-time
// Error) even though ExecuteWorkflow itself (unlike ValidateGraph)
// never checks a root's Kind -- kept Trigger-rooted anyway so this
// fixture stays valid input for both.
func decisionGraph(condition string) ([]Node, []Edge) {
	nodes := []Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "d", NodeTypeID: "decision-route"},
		{ID: "yes", NodeTypeID: "apply-clipboard-write-html"},
		{ID: "no", NodeTypeID: "apply-clipboard-write-text"},
	}
	edges := []Edge{
		{ID: "t-d", Source: "t", Target: "d"},
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

// The defect goal 0173's Rules panel exists to fix: evaluation order IS
// array order (nextNode's first-match-wins), not condition specificity
// or anything else visible to an author -- two edges carrying the exact
// same always-true condition prove it directly, since the ONLY thing
// that can decide which one runs is which comes first in the slice.
// Reordering that slice must flip the outcome.
func TestExecuteWorkflow_Decision_ReorderingEdgesChangesEvaluationOrder(t *testing.T) {
	var wroteHTML, wroteText bool
	withFakeClipboard(t, nil,
		func(string) error { wroteHTML = true; return nil },
		func(string) error { wroteText = true; return nil },
	)

	nodes := []Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "d", NodeTypeID: "decision-route"},
		{ID: "first", NodeTypeID: "apply-clipboard-write-html"},
		{ID: "second", NodeTypeID: "apply-clipboard-write-text"},
	}
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}

	tEdge := Edge{ID: "t-d", Source: "t", Target: "d"}
	edgeToFirst := Edge{ID: "d-first", Source: "d", Target: "first", SourceHandle: "true"}
	edgeToSecond := Edge{ID: "d-second", Source: "d", Target: "second", SourceHandle: "true"}

	if _, err := ExecuteWorkflow(resolved, []Edge{tEdge, edgeToFirst, edgeToSecond}, nil); err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if !wroteHTML || wroteText {
		t.Fatalf("original order: wroteHTML=%v wroteText=%v, want the first-listed edge's branch to win", wroteHTML, wroteText)
	}

	wroteHTML, wroteText = false, false
	if _, err := ExecuteWorkflow(resolved, []Edge{tEdge, edgeToSecond, edgeToFirst}, nil); err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if wroteHTML || !wroteText {
		t.Fatalf("reordered: wroteHTML=%v wroteText=%v, want reordering the edges to flip which branch wins", wroteHTML, wroteText)
	}
}

// Real proof that ExecuteWorkflow's variadic attrValues override
// actually changes execution, not just that a value gets stored
// somewhere (docs/adr/0008's test-input form): "urgent == true" would
// normally fall to the otherwise branch (urgent's zero value is false),
// but a supplied "urgent":"true" override must route to the matching
// branch instead.
func TestExecuteWorkflow_AttrValues_OverridesZeroValueDefault(t *testing.T) {
	var wroteHTML, wroteText bool
	withFakeClipboard(t, nil,
		func(string) error { wroteHTML = true; return nil },
		func(string) error { wroteText = true; return nil },
	)

	nodes, edges := decisionGraph("urgent == true")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	attrs := []AttributeDef{{Key: "urgent", Label: "Urgent", Type: FieldBoolean}}
	if _, err := ExecuteWorkflow(resolved, edges, attrs, ExecuteOptions{AttrValues: map[string]string{"urgent": "true"}}); err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if !wroteHTML || wroteText {
		t.Errorf("wroteHTML=%v wroteText=%v, want the overridden value to route to the matching branch", wroteHTML, wroteText)
	}
}

func TestValidateGraph_Decision_Valid_Accepted(t *testing.T) {
	nodes, edges := decisionGraph("urgent == false")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	attrs := []AttributeDef{{Key: "urgent", Label: "Urgent", Type: FieldBoolean}}
	if err := ValidateGraphStrict(resolved, edges, attrs); err != nil {
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
	if err := ValidateGraphStrict(resolved, edges, attrs); err == nil {
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
	if err := ValidateGraphStrict(resolved, edges, attrs); err == nil {
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
	if err := ValidateGraphStrict(resolved, edges, attrs); err == nil {
		t.Fatal("ValidateGraph comparing a text attribute with '>' returned nil error, want an error")
	}
}
