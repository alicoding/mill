package atlassvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// workflowRunner is the injected seam "Update now" (ADR-0038 decision
// 4) uses to run a card's RefreshWorkflowID through the NORMAL,
// guardrail-gated execution path -- mirrors composition.
// SetChildWorkflowRunner's package-level injected-function shape
// (.claude/rules/backend.md: data another layer owns, wired by an
// injected function, never a direct import of the owning service) so
// atlassvc never imports executionsvc. Only universal types cross the
// seam, not executionsvc's own RunSummary: the started run's id, and
// two booleans -- whether it already finished successfully by the time
// the call returns, and whether it's parked awaiting guardrail
// approval instead (in which case succeeded is always false; the real
// answer arrives later via NotifyRunCompleted below). Nil until
// main.go wires it (every standalone atlassvc test that doesn't call
// SetWorkflowRunner) -- UpdateNow reports that plainly rather than
// panicking.
var workflowRunner func(workflowID string) (runID string, succeeded bool, pending bool, err error)

// SetWorkflowRunner installs the seam -- called once from main.go,
// mirroring ExecutionService.WireChildWorkflowRunner.
//
//wails:ignore
func SetWorkflowRunner(fn func(workflowID string) (string, bool, bool, error)) {
	workflowRunner = fn
}

// UpdateNow runs cardID's RefreshWorkflowID through workflowRunner and
// stamps ReceiptRunID as soon as a run id exists -- the "on run start"
// half of ADR-0038 decision 4's stamping rule. When workflowRunner
// ALSO already knows the run succeeded (the common, non-approval-gated
// case -- RunWorkflow blocks until completion, so this is true by the
// time the call returns), LastSyncedAt is stamped right here too,
// deliberately NOT left to NotifyRunCompleted alone: that hook fires
// from INSIDE the same blocking RunWorkflow call, before ReceiptRunID
// is set on this card, so its own id-match would find nothing for a
// synchronous run -- a real ordering bug, not a hypothetical one, found
// while writing this. NotifyRunCompleted (below) remains the only path
// for a run that PARKS on guardrail approval and resolves long after
// this call has already returned, since by then ReceiptRunID has been
// set and the match succeeds.
func (a *AtlasService) UpdateNow(cardID string) (atlas.Card, error) {
	a.mu.RLock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		a.mu.RUnlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q", cardID)
	}
	// The FIRST attached action is the card's refresh (goal 0084:
	// actions generalized the single RefreshWorkflowID; migration
	// seats the legacy value at index 0, preserving this semantic).
	var workflowID string
	if len(a.cards[idx].ActionWorkflowIDs) > 0 {
		workflowID = a.cards[idx].ActionWorkflowIDs[0]
	}
	a.mu.RUnlock()
	if workflowID == "" {
		return atlas.Card{}, fmt.Errorf("card %q has no attached action to run", cardID)
	}
	if workflowRunner == nil {
		return atlas.Card{}, fmt.Errorf("update now: no workflow runner is wired")
	}

	runID, succeeded, _, err := workflowRunner(workflowID)
	if runID == "" {
		return atlas.Card{}, err
	}
	updated, err := a.stampReceipt(cardID, runID)
	if err != nil {
		return atlas.Card{}, err
	}
	if succeeded {
		return a.stampSynced(cardID)
	}
	return updated, nil
}

// NotifyRunCompleted is executionsvc's run-completion seam (main.go
// wires it via ExecutionService.SetRunCompletionSink) -- fires for
// EVERY run's completion, so every card whose ReceiptRunID names runID
// gets LastSyncedAt stamped the moment that run actually succeeds,
// however long that takes (immediately for a synchronous run, or after
// a human resolves a parked guardrail approval). A failed run leaves
// ReceiptRunID pointing at it (visible via the overlay's live status)
// without ever stamping LastSyncedAt. Exported for main.go's
// cross-service wiring only, same as ExecutionService.
// WireChildWorkflowRunner -- never a frontend RPC.
//
//wails:ignore
func (a *AtlasService) NotifyRunCompleted(runID string, succeeded bool) {
	if !succeeded {
		return
	}
	a.mu.RLock()
	var matches []string
	for _, c := range a.cards {
		if c.ReceiptRunID == runID {
			matches = append(matches, c.ID)
		}
	}
	a.mu.RUnlock()
	// Best-effort, same posture emitGuardrailPendingChanged/
	// emitHotkeyActivity already take for their own async
	// notification-driven writes -- there is no request this callback
	// could return an error to.
	for _, id := range matches {
		_, _ = a.stampSynced(id)
	}
}

func (a *AtlasService) stampReceipt(id, runID string) (atlas.Card, error) {
	a.mu.Lock()
	idx := a.findCardLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q", id)
	}
	previous := a.cards[idx]
	c := previous
	c.ReceiptRunID = runID
	a.cards[idx] = c
	perr := a.persistLocked()
	if perr != nil {
		a.cards[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Card{}, fmt.Errorf("save card receipt: %w", perr)
	}
	dataevent.Emit("atlas", id)
	return c, nil
}

func (a *AtlasService) stampSynced(id string) (atlas.Card, error) {
	a.mu.Lock()
	idx := a.findCardLocked(id)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q", id)
	}
	previous := a.cards[idx]
	c := previous
	c.LastSyncedAt = time.Now()
	a.cards[idx] = c
	perr := a.persistLocked()
	if perr != nil {
		a.cards[idx] = previous
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Card{}, fmt.Errorf("save card sync stamp: %w", perr)
	}
	dataevent.Emit("atlas", id)
	return c, nil
}
