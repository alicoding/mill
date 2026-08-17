package atlassvc

import (
	"fmt"
	"os"
)

// Restore kill-switch for shared-server e2e (same MILL_TEST_* seam
// family as the folder-pick and dense-atlas overrides): with many
// tests sharing one worker server, restore-on-mount hands each fresh
// page wherever the previous test stood, and a client-side reset
// cannot win the race against a closing page's trailing save. Saves
// still persist normally; only the read-back is suppressed. The
// dedicated session-restore spec runs its own server without this.
const testAtlasSessionOffEnv = "MILL_TEST_ATLAS_SESSION_OFF"

// AtlasSessionState is the map's where-you-were (goal 0091): the
// viewed level and the open card page, persisted per-device beside
// the lens settings so a restart lands where you stood. The nav
// stack behind the open page stays session-local (recorded residual
// in the goal file).
type AtlasSessionState struct {
	ViewedID   string `json:"viewedID"`
	OpenCardID string `json:"openCardID"`
}

// SetAtlasSession persists the current session state -- a zero state
// clears the entry (same no-op-avoidance posture SetLens takes). No
// dataevent: nothing else renders off this, and emitting would
// refresh the very view mid-navigation.
func (a *AtlasService) SetAtlasSession(state AtlasSessionState) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	previous := a.session
	a.session = state
	if err := a.persistLocked(); err != nil {
		a.session = previous
		return fmt.Errorf("save atlas session: %w", err)
	}
	return nil
}

// AtlasSession returns the persisted state, DEGRADED to what still
// exists: a deleted viewed card falls back to its nearest surviving
// ancestor (root ultimately); a deleted open card is dropped. The
// caller never has to handle a stale id.
func (a *AtlasService) AtlasSession() AtlasSessionState {
	if os.Getenv(testAtlasSessionOffEnv) != "" {
		return AtlasSessionState{}
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	out := a.session
	for out.ViewedID != "" {
		idx := a.findCardLocked(out.ViewedID)
		if idx >= 0 {
			break
		}
		out.ViewedID = a.parentOfMissingLocked(out.ViewedID)
	}
	if out.OpenCardID != "" && a.findCardLocked(out.OpenCardID) == -1 {
		out.OpenCardID = ""
	}
	return out
}

// parentOfMissingLocked can't know a deleted card's parent -- degrade
// straight to root. Kept as its own hook so a future tombstone record
// could do better without touching AtlasSession's contract.
func (a *AtlasService) parentOfMissingLocked(string) string { return "" }
