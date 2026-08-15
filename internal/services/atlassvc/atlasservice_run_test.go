package atlassvc

import (
	"errors"
	"testing"
)

// TestUpdateNow_NoRefreshWorkflow_Errors proves UpdateNow refuses a
// card with no RefreshWorkflowID rather than calling a nil/unrelated
// runner.
func TestUpdateNow_NoRefreshWorkflow_Errors(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.CreateCard(k.ID, "A widget", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	if _, err := a.UpdateNow(c.ID); err == nil {
		t.Error("UpdateNow() on a card with no RefreshWorkflowID = nil error, want an error")
	}
}

// TestUpdateNow_SynchronousSuccess_StampsBothReceiptAndSync proves the
// common case (workflowRunner already knows the run succeeded by the
// time it returns -- RunWorkflow blocks until completion): UpdateNow
// stamps BOTH ReceiptRunID and LastSyncedAt itself, in that call, never
// relying on NotifyRunCompleted alone for this path (NotifyRunCompleted
// fires from INSIDE the same blocking call, before ReceiptRunID is set
// on this card, so its own id-match would find nothing here).
func TestUpdateNow_SynchronousSuccess_StampsBothReceiptAndSync(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.CreateCard(k.ID, "A widget", "", nil, "", nil, "", "", "", "workflow-x")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	t.Cleanup(func() { SetWorkflowRunner(nil) })
	SetWorkflowRunner(func(workflowID string) (string, bool, bool, error) {
		if workflowID != "workflow-x" {
			t.Errorf("workflowRunner called with %q, want %q", workflowID, "workflow-x")
		}
		return "run-1", true, false, nil
	})

	updated, err := a.UpdateNow(c.ID)
	if err != nil {
		t.Fatalf("UpdateNow: %v", err)
	}
	if updated.ReceiptRunID != "run-1" {
		t.Errorf("ReceiptRunID = %q, want %q", updated.ReceiptRunID, "run-1")
	}
	if updated.LastSyncedAt.IsZero() {
		t.Error("LastSyncedAt was not stamped for a synchronously-succeeded run")
	}
}

// TestUpdateNow_ParkedThenResolved_NotifyRunCompletedStampsSync proves
// the deferred case: a run that PARKS for guardrail approval only gets
// ReceiptRunID stamped by UpdateNow; LastSyncedAt is stamped later, once
// NotifyRunCompleted reports that exact run id succeeded -- by then
// ReceiptRunID already matches, since UpdateNow's own call has long
// since returned.
func TestUpdateNow_ParkedThenResolved_NotifyRunCompletedStampsSync(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.CreateCard(k.ID, "A widget", "", nil, "", nil, "", "", "", "workflow-x")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	t.Cleanup(func() { SetWorkflowRunner(nil) })
	SetWorkflowRunner(func(string) (string, bool, bool, error) {
		return "run-1", false, true, nil
	})

	updated, err := a.UpdateNow(c.ID)
	if err != nil {
		t.Fatalf("UpdateNow: %v", err)
	}
	if updated.ReceiptRunID != "run-1" {
		t.Errorf("ReceiptRunID = %q, want %q", updated.ReceiptRunID, "run-1")
	}
	if !updated.LastSyncedAt.IsZero() {
		t.Error("LastSyncedAt stamped for a run that only parked, want it to stay zero until resolved")
	}

	a.NotifyRunCompleted("run-1", true)

	found := false
	for _, card := range a.Cards() {
		if card.ID == c.ID {
			found = true
			if card.LastSyncedAt.IsZero() {
				t.Error("LastSyncedAt still zero after NotifyRunCompleted(runID, true) for this card's own ReceiptRunID")
			}
		}
	}
	if !found {
		t.Fatal("card vanished")
	}
}

// TestUpdateNow_ReceiptStamped_PendingRun_NoSyncUntilResolved proves a
// run that PARKS for guardrail approval (workflowRunner's pending=true)
// only gets ReceiptRunID stamped -- LastSyncedAt waits for
// NotifyRunCompleted, which may arrive long after UpdateNow returns.
func TestUpdateNow_ReceiptStamped_PendingRun_NoSyncUntilResolved(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.CreateCard(k.ID, "A widget", "", nil, "", nil, "", "", "", "workflow-x")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	t.Cleanup(func() { SetWorkflowRunner(nil) })
	SetWorkflowRunner(func(string) (string, bool, bool, error) {
		return "run-2", false, true, nil
	})

	updated, err := a.UpdateNow(c.ID)
	if err != nil {
		t.Fatalf("UpdateNow: %v", err)
	}
	if updated.ReceiptRunID != "run-2" {
		t.Errorf("ReceiptRunID = %q, want %q", updated.ReceiptRunID, "run-2")
	}

	// The run later fails (approval denied) -- NotifyRunCompleted(id,
	// false) must never stamp LastSyncedAt.
	a.NotifyRunCompleted("run-2", false)
	for _, card := range a.Cards() {
		if card.ID == c.ID && !card.LastSyncedAt.IsZero() {
			t.Error("LastSyncedAt stamped after a failed run's completion notification")
		}
	}
}

// TestUpdateNow_RunnerStartFailure_PropagatesError proves a workflow
// that never actually started (workflowRunner returns an empty runID)
// surfaces the underlying error and never stamps a receipt.
func TestUpdateNow_RunnerStartFailure_PropagatesError(t *testing.T) {
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.CreateCard(k.ID, "A widget", "", nil, "", nil, "", "", "", "workflow-x")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	t.Cleanup(func() { SetWorkflowRunner(nil) })
	wantErr := errors.New("workflow is disabled")
	SetWorkflowRunner(func(string) (string, bool, bool, error) {
		return "", false, false, wantErr
	})

	if _, err := a.UpdateNow(c.ID); err == nil {
		t.Error("UpdateNow() with a runner start failure = nil error, want an error")
	}
}

// TestUpdateNow_NoRunnerWired_Errors proves UpdateNow fails loudly
// rather than silently no-op'ing when nothing wired SetWorkflowRunner
// (a standalone test/build, mirroring composition.SetChildWorkflowRunner's
// own nil-seam posture).
func TestUpdateNow_NoRunnerWired_Errors(t *testing.T) {
	SetWorkflowRunner(nil)
	a := newTestAtlasService(t)
	k, err := a.CreateKind("Widget", "", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	c, err := a.CreateCard(k.ID, "A widget", "", nil, "", nil, "", "", "", "workflow-x")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	if _, err := a.UpdateNow(c.ID); err == nil {
		t.Error("UpdateNow() with no runner wired = nil error, want an error")
	}
}
