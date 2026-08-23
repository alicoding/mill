package composition

import (
	"strings"
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

// TestFindRoot_PureCycle_NamesTheLoopingNodes is goal 0021 gap 4's
// repro: a graph where every node has an incoming edge (a pure cycle,
// no Trigger at all) used to report only "a workflow must have exactly
// one starting node" -- true, but it left an authoring agent to find
// the loop by process of elimination. findRoot must now name the
// actual node IDs that loop.
func TestFindRoot_PureCycle_NamesTheLoopingNodes(t *testing.T) {
	nodes := []Node{
		{ID: "a", NodeTypeID: "process-inject-text"},
		{ID: "b", NodeTypeID: "process-inject-text"},
		{ID: "c", NodeTypeID: "process-inject-text"},
	}
	edges := []Edge{
		{ID: "e1", Source: "a", Target: "b"},
		{ID: "e2", Source: "b", Target: "c"},
		{ID: "e3", Source: "c", Target: "a"},
	}

	_, err := ExecuteWorkflow(nodes, edges, nil)
	if err == nil {
		t.Fatal("ExecuteWorkflow on a pure cycle returned nil error, want an error")
	}
	if !strings.Contains(err.Error(), "a -> b -> c -> a") {
		t.Fatalf("error = %q, want it to name the actual cycle (a -> b -> c -> a)", err.Error())
	}

	issues := ValidateGraph(nodes, edges, nil)
	var found bool
	for _, iss := range issues {
		if strings.Contains(iss.Message, "a -> b -> c -> a") {
			found = true
		}
	}
	if !found {
		t.Fatalf("ValidateGraph issues = %+v, want one naming the cycle (a -> b -> c -> a)", issues)
	}
}

// TestExecuteWorkflow_CycleDownstreamOfARealRoot_NamesTheLoopingNodes
// is the sibling case: a graph WITH a valid, unique Trigger root (so
// findRoot succeeds and ValidateGraph's reachability walk sees every
// node as reachable -- it doesn't check for cycles, only
// unreachability) but that loops further downstream. Only actual
// execution's own traversal catches this one, and its error must name
// the loop too, not just say "contains a cycle".
func TestExecuteWorkflow_CycleDownstreamOfARealRoot_NamesTheLoopingNodes(t *testing.T) {
	nodes := []Node{
		{ID: "t", NodeTypeID: "trigger-manual", Kind: KindTrigger},
		{ID: "a", NodeTypeID: "process-inject-text"},
		{ID: "b", NodeTypeID: "process-inject-text"},
	}
	edges := []Edge{
		{ID: "e1", Source: "t", Target: "a"},
		{ID: "e2", Source: "a", Target: "b"},
		{ID: "e3", Source: "b", Target: "a"},
	}

	_, err := ExecuteWorkflow(nodes, edges, nil)
	if err == nil {
		t.Fatal("ExecuteWorkflow on a downstream cycle returned nil error, want an error")
	}
	if !strings.Contains(err.Error(), "a -> b -> a") {
		t.Fatalf("error = %q, want it to name the actual loop (a -> b -> a)", err.Error())
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
	if err := ValidateGraphStrict(nodes, edges, nil); err == nil {
		t.Fatal("ValidateGraph with a disconnected cycle-plus-chain graph returned nil error, want an error")
	}
}

// Decision node tests (branching walk + save-time rule validation) live
// in decision_test.go, split out along that domain-concept seam.

// --- Terminal node (KindTerminal, docs/adr/0027): the standing
// three-layer agreement -- ValidateGraph (save-time) and ExecuteWorkflow/
// buildGraph (run-time) both reject an outgoing edge from a terminal
// node; the frontend's isValidConnection/draftWorkflowSchema are the
// draw-time layer, covered separately (not Go-testable). ---

func terminalGraph(withOutgoingEdge bool) ([]Node, []Edge) {
	nodes := []Node{
		{ID: "t1", NodeTypeID: "trigger-manual"},
		{ID: "d1", NodeTypeID: "decision-outcome", Config: map[string]string{"decisionId": "dec-1"}},
	}
	edges := []Edge{{ID: "e1", Source: "t1", Target: "d1"}}
	if withOutgoingEdge {
		nodes = append(nodes, Node{ID: "a2", NodeTypeID: "apply-clipboard-write-text"})
		edges = append(edges, Edge{ID: "e2", Source: "d1", Target: "a2"})
	}
	return nodes, edges
}

func TestValidateGraph_TerminalNode_OutgoingEdge_Rejected(t *testing.T) {
	nodes, edges := terminalGraph(true)
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if err := ValidateGraphStrict(resolved, edges, nil); err == nil {
		t.Fatal("ValidateGraph with an outgoing edge from a terminal node returned nil error, want an error")
	}
}

func TestExecuteWorkflow_TerminalNode_OutgoingEdge_Rejected(t *testing.T) {
	nodes, edges := terminalGraph(true)
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if _, err := ExecuteWorkflow(resolved, edges, nil); err == nil {
		t.Fatal("ExecuteWorkflow with an outgoing edge from a terminal node returned nil error, want an error")
	}
}

func TestValidateGraph_TerminalNode_NoOutgoingEdge_Accepted(t *testing.T) {
	withDecisionLookup(t, func(string, int) (ResolvedDecision, error) {
		return approveDecision(), nil
	})
	nodes, edges := terminalGraph(false)
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if err := ValidateGraphStrict(resolved, edges, nil); err != nil {
		t.Fatalf("ValidateGraph with a well-formed terminal node returned error: %v", err)
	}
}

// A workflow may have more than one terminal node (one per branch
// outcome, docs/adr/0027) -- findRoot's own "exactly one starting
// node" rule is about the workflow's single root, not its terminals.
func TestValidateGraph_MultipleTerminalNodes_Accepted(t *testing.T) {
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t1", NodeTypeID: "trigger-manual"},
		{ID: "r1", NodeTypeID: "decision-route"},
		{ID: "d1", NodeTypeID: "decision-outcome", Config: map[string]string{"decisionId": "dec-1"}},
		{ID: "d2", NodeTypeID: "decision-outcome", Config: map[string]string{"decisionId": "dec-2"}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	edges := []Edge{
		{ID: "e1", Source: "t1", Target: "r1"},
		{ID: "e2", Source: "r1", SourceHandle: "otherwise", Target: "d1"},
	}
	// A Decision node needs at least one non-otherwise edge too, or
	// buildGraph's own out-degree check never gets exercised -- add a
	// second, always-false branch to d2 so both terminals are reachable.
	edges = append([]Edge{{ID: "e3", Source: "r1", SourceHandle: "false", Target: "d2"}}, edges...)
	if err := ValidateGraphStrict(nodes, edges, nil); err != nil {
		t.Fatalf("ValidateGraph with two terminal nodes returned error: %v", err)
	}
}

// Regression: validation issues named steps by raw node id -- an id
// means nothing to a reader; the message must carry the step's type
// label (Issue.NodeID keeps the id for programmatic use). Also pins the
// Trigger exemption: a trigger never executes as a step, so its empty
// optional ref (system-event's workflow scope) must not warn at all.
func TestValidateGraph_RequiredRefWarning_NamesStepByLabelAndSkipsTriggers(t *testing.T) {
	nodes := []Node{
		{ID: "t1", Kind: KindTrigger, NodeTypeID: "trigger-system-event", Config: map[string]string{}},
		{ID: "d1", Kind: KindTerminal, NodeTypeID: "decision-outcome", Config: map[string]string{}},
	}
	edges := []Edge{{ID: "e1", Source: "t1", Target: "d1"}}
	var willFail []Issue
	for _, is := range ValidateGraph(nodes, edges, nil) {
		if is.WillFail {
			willFail = append(willFail, is)
		}
	}
	if len(willFail) != 1 {
		t.Fatalf("WillFail issues = %d, want exactly 1 (the unset Decision ref; the trigger's empty scope must not warn): %v", len(willFail), willFail)
	}
	if willFail[0].NodeID != "d1" {
		t.Errorf("issue NodeID = %q, want d1", willFail[0].NodeID)
	}
	if !strings.Contains(willFail[0].Message, `"Record decision"`) || strings.Contains(willFail[0].Message, "d1") {
		t.Errorf("message must name the step by label, never id: %q", willFail[0].Message)
	}
}

// The credential-gap check (goal 0127 slice 3): a SET request ref
// whose integration lacks a stored credential is a WillFail warning
// naming the step and the fix location; an unwired seam (nil) checks
// nothing.
func TestValidateGraph_CredentialGap_WillFailNamingTheIntegration(t *testing.T) {
	SetCredentialGapCheck(func(requestID string) (bool, string) {
		return requestID == "req-gap", "Confluence (PAT)"
	})
	defer SetCredentialGapCheck(nil)

	nodes := []Node{
		{ID: "t1", Kind: KindTrigger, NodeTypeID: "trigger-manual", Config: map[string]string{}},
		{ID: "n1", Kind: KindProcess, NodeTypeID: "integration-http", Config: map[string]string{"requestId": "req-gap"}},
	}
	edges := []Edge{{ID: "e1", Source: "t1", Target: "n1"}}
	var willFail []Issue
	for _, is := range ValidateGraph(nodes, edges, nil) {
		if is.WillFail {
			willFail = append(willFail, is)
		}
	}
	if len(willFail) != 1 {
		t.Fatalf("WillFail issues = %d, want the one credential gap: %v", len(willFail), willFail)
	}
	if !strings.Contains(willFail[0].Message, `"Confluence (PAT)"`) || !strings.Contains(willFail[0].Message, "Configure") {
		t.Errorf("message must name the integration and the fix location: %q", willFail[0].Message)
	}

	// A request whose credential exists stays clean.
	nodes[1].Config["requestId"] = "req-ok"
	for _, is := range ValidateGraph(nodes, edges, nil) {
		if is.WillFail {
			t.Errorf("credentialed request flagged: %+v", is)
		}
	}
}
