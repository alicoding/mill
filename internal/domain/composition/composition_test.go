package composition

import (
	"errors"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/capabilities"
)

func withFakeClipboard(t *testing.T, read func() (string, error), writeHTML, writeText func(string) error) {
	t.Helper()
	origRead, origWriteHTML, origWriteText := readClipboardHTML, writeClipboardHTML, writeClipboardText
	if read != nil {
		readClipboardHTML = read
	}
	if writeHTML != nil {
		writeClipboardHTML = writeHTML
	}
	if writeText != nil {
		writeClipboardText = writeText
	}
	t.Cleanup(func() {
		readClipboardHTML = origRead
		writeClipboardHTML = origWriteHTML
		writeClipboardText = origWriteText
	})
}

// chain builds a linear node/edge graph from an ordered list of node
// type IDs, giving each node a predictable ID (its type ID) so tests can
// reference them -- real callers (the canvas) generate random IDs, but
// tests want stable, readable ones.
func chain(nodeTypeIDs ...string) ([]Node, []Edge) {
	nodes := make([]Node, len(nodeTypeIDs))
	for i, id := range nodeTypeIDs {
		nodes[i] = Node{ID: id, NodeTypeID: id}
	}
	edges := make([]Edge, 0, len(nodeTypeIDs)-1)
	for i := 0; i < len(nodeTypeIDs)-1; i++ {
		edges = append(edges, Edge{ID: nodeTypeIDs[i] + "-" + nodeTypeIDs[i+1], Source: nodeTypeIDs[i], Target: nodeTypeIDs[i+1]})
	}
	return nodes, edges
}

func TestNodeTypes(t *testing.T) {
	types := NodeTypes()
	if len(types) == 0 {
		t.Fatal("NodeTypes() returned no node types")
	}
	seen := make(map[string]bool)
	for _, nt := range types {
		if nt.ID == "" || nt.Label == "" || nt.Description == "" {
			t.Errorf("node type %+v has an empty ID/Label/Description", nt)
		}
		if seen[nt.ID] {
			t.Errorf("duplicate node type ID %q", nt.ID)
		}
		seen[nt.ID] = true
		for _, f := range nt.ConfigFields {
			if f.Key == "" || f.Label == "" {
				t.Errorf("node type %q has a config field with an empty Key/Label: %+v", nt.ID, f)
			}
		}
	}
}

func TestBuiltInWorkflows_AllNodesFullyResolvedAndExecutable(t *testing.T) {
	for _, wf := range BuiltInWorkflows() {
		if !wf.BuiltIn {
			t.Errorf("workflow %q from BuiltInWorkflows() has BuiltIn=false", wf.ID)
		}
		if len(wf.Nodes) == 0 {
			t.Errorf("workflow %q has no nodes", wf.ID)
		}
		for _, node := range wf.Nodes {
			nt, ok := nodeType(node.NodeTypeID)
			if !ok {
				t.Errorf("workflow %q references unknown node type %q", wf.ID, node.NodeTypeID)
				continue
			}
			if node.Kind != nt.Kind {
				t.Errorf("workflow %q node %q has Kind %q, want %q (derived from node type)", wf.ID, node.NodeTypeID, node.Kind, nt.Kind)
			}
			for _, field := range nt.ConfigFields {
				if _, ok := node.Config[field.Key]; !ok {
					t.Errorf("workflow %q node %q missing resolved config key %q", wf.ID, node.NodeTypeID, field.Key)
				}
			}
		}
		// Every built-in workflow must itself form a valid graph --
		// exercising ValidateGraph against real seeded data, not just
		// hand-built test fixtures.
		if err := ValidateGraph(wf.Nodes, wf.Edges, wf.Attributes); err != nil {
			t.Errorf("workflow %q nodes/edges don't form a valid graph: %v", wf.ID, err)
		}
	}
}

func TestResolveNodeDefaults_FillsMissingKeysWithDefaults(t *testing.T) {
	resolved, err := ResolveNodeDefaults([]Node{{NodeTypeID: "apply-clipboard-write-html"}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if resolved[0].Config["html"] != sampleHTML {
		t.Errorf("resolved config[html] = %q, want the field's default", resolved[0].Config["html"])
	}
}

func TestResolveNodeDefaults_PreservesExplicitValue(t *testing.T) {
	resolved, err := ResolveNodeDefaults([]Node{
		{NodeTypeID: "apply-clipboard-write-html", Config: map[string]string{"html": "<p>custom</p>"}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if resolved[0].Config["html"] != "<p>custom</p>" {
		t.Errorf("resolved config[html] = %q, want the explicit value preserved, not overwritten by the default", resolved[0].Config["html"])
	}
}

func TestResolveNodeDefaults_UnknownNodeType(t *testing.T) {
	if _, err := ResolveNodeDefaults([]Node{{NodeTypeID: "does-not-exist"}}); err == nil {
		t.Fatal("ResolveNodeDefaults(unknown node type) returned nil error, want an error")
	}
}

func TestResolveNodeDefaults_AssignsIDWhenMissing(t *testing.T) {
	resolved, err := ResolveNodeDefaults([]Node{{NodeTypeID: "capture-clipboard-html"}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if resolved[0].ID == "" {
		t.Error("ResolveNodeDefaults left ID empty, want a generated ID")
	}
}

func TestResolveNodeDefaults_PreservesExplicitID(t *testing.T) {
	resolved, err := ResolveNodeDefaults([]Node{{ID: "my-node", NodeTypeID: "capture-clipboard-html"}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if resolved[0].ID != "my-node" {
		t.Errorf("resolved ID = %q, want the explicit ID preserved", resolved[0].ID)
	}
}

func TestResolveNodeDefaults_DerivesKindFromNodeType(t *testing.T) {
	// A client-supplied Kind must never be trusted -- ResolveNodeDefaults
	// always overwrites it from the looked-up node type, so it can't
	// drift out of sync with the node type it names.
	resolved, err := ResolveNodeDefaults([]Node{{NodeTypeID: "capture-clipboard-html", Kind: "bogus"}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if resolved[0].Kind != KindCapture {
		t.Errorf("resolved Kind = %q, want %q derived from the node type, not the client-supplied value", resolved[0].Kind, KindCapture)
	}
}

func TestExecuteWorkflow_UnknownNodeType(t *testing.T) {
	nodes, edges := chain("does-not-exist")
	if _, err := ExecuteWorkflow(nodes, edges, nil); err == nil {
		t.Fatal("ExecuteWorkflow(unknown node type) returned nil error, want an error")
	}
}

func TestExecuteWorkflow_LoadSampleHTML_UsesDefault(t *testing.T) {
	var written string
	withFakeClipboard(t, nil, func(html string) error {
		written = html
		return nil
	}, nil)

	nodes, err := ResolveNodeDefaults([]Node{{NodeTypeID: "apply-clipboard-write-html"}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	result, err := ExecuteWorkflow(nodes, nil, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if written != sampleHTML {
		t.Errorf("apply-clipboard-write-html was called with %q, want the sample HTML", written)
	}
	if !strings.Contains(result, "Quarterly update") {
		t.Errorf("ExecuteWorkflow result = %q, want it to contain the sample HTML", result)
	}
}

func TestExecuteWorkflow_LoadSampleHTML_UsesConfiguredValue(t *testing.T) {
	var written string
	withFakeClipboard(t, nil, func(html string) error {
		written = html
		return nil
	}, nil)

	nodes, err := ResolveNodeDefaults([]Node{
		{NodeTypeID: "apply-clipboard-write-html", Config: map[string]string{"html": "<p>custom configured value</p>"}},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	result, err := ExecuteWorkflow(nodes, nil, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if written != "<p>custom configured value</p>" {
		t.Errorf("apply-clipboard-write-html was called with %q, want the configured (non-default) value", written)
	}
	if !strings.Contains(result, "custom configured value") {
		t.Errorf("ExecuteWorkflow result = %q, want the configured value", result)
	}
}

func TestExecuteWorkflow_ClipboardHTMLToMarkdown(t *testing.T) {
	var written string
	withFakeClipboard(t, func() (string, error) {
		return "<h2>Hi</h2><p>the <strong>bit</strong></p>", nil
	}, nil, func(md string) error {
		written = md
		return nil
	})

	nodes, edges := chain("capture-clipboard-html", "process-html-to-markdown", "apply-clipboard-write-text")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	result, err := ExecuteWorkflow(resolved, edges, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if !strings.Contains(result, "## Hi") || !strings.Contains(result, "**bit**") {
		t.Errorf("ExecuteWorkflow result = %q, want converted markdown", result)
	}
	if written != result {
		t.Errorf("apply-clipboard-write-text was called with %q, want it to match the returned markdown %q", written, result)
	}
}

func TestExecuteWorkflow_ClipboardHTMLToMarkdown_NoHTMLOnClipboard(t *testing.T) {
	withFakeClipboard(t, func() (string, error) {
		return "", errors.New("no HTML on clipboard")
	}, nil, nil)

	nodes, edges := chain("capture-clipboard-html", "process-html-to-markdown", "apply-clipboard-write-text")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	// Unlike internal/domain/runbook's soft-failure path (nil error,
	// friendly explanation), this prototype's executor surfaces a plain
	// error -- documented as a deliberate simplification in
	// ExecuteWorkflow's doc comment, confirmed here so it isn't mistaken
	// for a bug later.
	if _, err := ExecuteWorkflow(resolved, edges, nil); err == nil {
		t.Fatal("ExecuteWorkflow with no clipboard HTML returned nil error, want an error (plain-error prototype behavior, unlike runbook's soft-failure)")
	}
}

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

func TestCapabilityMap(t *testing.T) {
	entries := CapabilityMap()
	if len(entries) == 0 {
		t.Fatal("CapabilityMap() returned no entries")
	}
	seen := make(map[string]bool)
	validApproach := map[Approach]bool{ApproachAdopt: true, ApproachBuild: true, ApproachMixed: true}
	validStatus := map[capabilities.Status]bool{
		capabilities.StatusLocked: true, capabilities.StatusOpen: true, capabilities.StatusParked: true,
	}
	for _, e := range entries {
		if e.ID == "" || e.Name == "" || e.WhatItDoes == "" {
			t.Errorf("capability map entry %+v has an empty ID/Name/WhatItDoes", e)
		}
		if seen[e.ID] {
			t.Errorf("duplicate capability map entry ID %q", e.ID)
		}
		seen[e.ID] = true
		if !validApproach[e.Approach] {
			t.Errorf("entry %q has invalid Approach %q", e.ID, e.Approach)
		}
		if !validStatus[e.Status] {
			t.Errorf("entry %q has invalid Status %q", e.ID, e.Status)
		}
		if e.ApproachDetail == "" || e.StatusDetail == "" {
			t.Errorf("entry %q has an empty ApproachDetail/StatusDetail", e.ID)
		}
	}
}
