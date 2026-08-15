package composition

import (
	"testing"
	"time"
)

// A Note carries no Kind/NodeTypeID -- it structurally cannot appear in
// a NodeType registry entry, ValidateGraph's issue list, or an
// ExecuteWorkflow walk, all of which only ever accept []Node/[]Edge
// (never []Note or a *Workflow) as parameters. These tests pin that
// down against real graph/execution runs, not just the type shape.

// TestNote_ExcludedFromValidateGraph: a Note sharing a Node's own ID and
// sitting on top of it produces zero validation issues -- ValidateGraph
// never receives Notes at all, so nothing about a Note's content (even
// a colliding ID) can influence its output.
func TestNote_ExcludedFromValidateGraph(t *testing.T) {
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "c", NodeTypeID: "capture-clipboard-html"},
		{ID: "a", NodeTypeID: "apply-clipboard-write-text"},
	})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	edges := []Edge{
		{ID: "e1", Source: "t", Target: "c"},
		{ID: "e2", Source: "c", Target: "a"},
	}
	wf := Workflow{
		Nodes: nodes,
		Edges: edges,
		Notes: []Note{{ID: "t", Text: "same id as the trigger node on purpose", Position: Position{X: 999, Y: 999}}},
	}

	issues := ValidateGraph(wf.Nodes, wf.Edges, wf.Attributes)
	if len(issues) != 0 {
		t.Errorf("ValidateGraph returned %d issues for a valid graph carrying an id-colliding Note, want 0: %+v", len(issues), issues)
	}
}

// TestNote_ExcludedFromExecuteWorkflow: a run through a Workflow's
// Nodes/Edges/Attributes produces the identical result whether or not
// that Workflow also carries Notes -- ExecuteWorkflow's signature never
// takes a Note, so a run can't see them.
func TestNote_ExcludedFromExecuteWorkflow(t *testing.T) {
	nodes, err := ResolveNodeDefaults([]Node{{ID: "t", NodeTypeID: "trigger-manual"}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	withoutNote := Workflow{Nodes: nodes}
	withNote := Workflow{Nodes: nodes, Notes: []Note{{ID: "n1", Text: "documents this workflow"}}}

	resultWithout, errWithout := ExecuteWorkflow(withoutNote.Nodes, withoutNote.Edges, withoutNote.Attributes)
	resultWith, errWith := ExecuteWorkflow(withNote.Nodes, withNote.Edges, withNote.Attributes)
	if errWithout != nil || errWith != nil {
		t.Fatalf("ExecuteWorkflow errors: without-note=%v with-note=%v", errWithout, errWith)
	}
	if resultWithout != resultWith {
		t.Errorf("a Note changed ExecuteWorkflow's result: without=%q with=%q", resultWithout, resultWith)
	}
}

// TestSnapshotHead_CopiesNotes: a version snapshot preserves the draft
// head's Notes, the same way it already preserves Nodes/Edges/Attributes.
func TestSnapshotHead_CopiesNotes(t *testing.T) {
	wf := Workflow{
		Nodes: []Node{{ID: "t", NodeTypeID: "trigger-manual"}},
		Notes: []Note{{ID: "n1", Text: "a note", Color: NoteColorYellow}},
	}
	snap := SnapshotHead(wf, time.Now())
	if len(snap.Notes) != 1 || snap.Notes[0].ID != "n1" || snap.Notes[0].Color != NoteColorYellow {
		t.Errorf("SnapshotHead.Notes = %+v, want the draft head's Notes copied through", snap.Notes)
	}
}
