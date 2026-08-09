package composition

import (
	"strings"
	"testing"
	"time"
)

func versionedWorkflow() Workflow {
	wf := Workflow{
		ID: "wf-1", Label: "V1 label",
		Nodes: []Node{{ID: "n1", NodeTypeID: "trigger-manual"}},
	}
	wf = PublishHead(wf, time.Unix(1000, 0))
	// Edit the draft after publishing -- the head now differs from v1.
	wf.Label = "Draft label"
	wf.Nodes = []Node{{ID: "n1", NodeTypeID: "trigger-manual"}, {ID: "n2", NodeTypeID: "process-inject-text"}}
	return wf
}

func TestSnapshotHead_NumbersMonotonically_EvenAfterRepublishingOld(t *testing.T) {
	wf := versionedWorkflow()                // has v1
	wf = PublishHead(wf, time.Unix(2000, 0)) // v2
	wf.PublishedVersion = 1                  // roll back the pointer
	snap := SnapshotHead(wf, time.Unix(3000, 0))
	if snap.Version != 3 {
		t.Errorf("next version after rollback = %d, want 3 (max existing + 1, never reusing a number)", snap.Version)
	}
}

func TestResolveRunnable_TestRunsExecuteTheDraft(t *testing.T) {
	wf := versionedWorkflow()
	nodes, _, _, version, err := ResolveRunnable(wf, true, 0)
	if err != nil {
		t.Fatalf("ResolveRunnable(draft): %v", err)
	}
	if version != 0 || len(nodes) != 2 {
		t.Errorf("draft resolution = version %d, %d nodes; want version 0 (draft) with the edited 2-node head", version, len(nodes))
	}
}

func TestResolveRunnable_ProductionRunsExecuteThePublishedSnapshot(t *testing.T) {
	wf := versionedWorkflow()
	nodes, _, _, version, err := ResolveRunnable(wf, false, 0)
	if err != nil {
		t.Fatalf("ResolveRunnable(published): %v", err)
	}
	if version != 1 || len(nodes) != 1 {
		t.Errorf("published resolution = version %d, %d nodes; want v1's single-node snapshot, never the edited draft", version, len(nodes))
	}
}

func TestResolveRunnable_UnpublishedIsRejectedForProduction_ButTestsStillRun(t *testing.T) {
	wf := Workflow{ID: "wf-2", Label: "Never published", Nodes: []Node{{ID: "n1", NodeTypeID: "trigger-manual"}}}
	if _, _, _, _, err := ResolveRunnable(wf, false, 0); err == nil || !strings.Contains(err.Error(), "no published version") {
		t.Errorf("production run on unpublished workflow: err = %v, want a publish-it-first rejection", err)
	}
	if _, _, _, _, err := ResolveRunnable(wf, true, 0); err != nil {
		t.Errorf("test run on unpublished workflow errored: %v -- the draft must stay runnable pre-publish", err)
	}
}

func TestResolveRunnable_DisabledIsRejectedForProductionAndPins_ButTestsStillRun(t *testing.T) {
	wf := versionedWorkflow()
	wf.Disabled = true
	if _, _, _, _, err := ResolveRunnable(wf, false, 0); err == nil || !strings.Contains(err.Error(), "disabled") {
		t.Errorf("production run on disabled workflow: err = %v, want a disabled rejection", err)
	}
	if _, _, _, _, err := ResolveRunnable(wf, false, 1); err == nil || !strings.Contains(err.Error(), "disabled") {
		t.Errorf("pinned run on disabled workflow: err = %v, want a disabled rejection", err)
	}
	if _, _, _, _, err := ResolveRunnable(wf, true, 0); err != nil {
		t.Errorf("test run on disabled workflow errored: %v -- disabling pauses production, not debugging (n8n semantics, ADR-0021)", err)
	}
}

func TestResolveRunnable_PinnedVersionWins_AndMissingPinIsRejected(t *testing.T) {
	wf := versionedWorkflow()                // v1 published
	wf = PublishHead(wf, time.Unix(2000, 0)) // v2 published (2-node draft)
	nodes, _, _, version, err := ResolveRunnable(wf, false, 1)
	if err != nil {
		t.Fatalf("ResolveRunnable(pinned 1): %v", err)
	}
	if version != 1 || len(nodes) != 1 {
		t.Errorf("pinned resolution = version %d, %d nodes; want v1's snapshot even though v2 is published", version, len(nodes))
	}
	if _, _, _, _, err := ResolveRunnable(wf, false, 99); err == nil {
		t.Error("pin to a missing version resolved; want a rejection")
	}
}
