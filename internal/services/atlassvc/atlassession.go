package atlassvc

import (
	"fmt"
	"os"

	"github.com/alicoding/mill/internal/domain/atlas"
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
	// ActivePerspectiveID names the currently-switched-to Perspective
	// (ADR-0041, goal 0095) -- "" is the default "everything" view (the
	// absence of a Perspective, never an empty one). Degraded on read
	// like its siblings: a perspective deleted since this was set
	// resolves back to "".
	ActivePerspectiveID string `json:"activePerspectiveID"`
	// AtRootExplicit (goal 0221) distinguishes a deliberate "All spaces"
	// landing from the zero-value default -- both otherwise leave
	// ViewedID=="", indistinguishable to a restoring client. The
	// egocentric-root auto-entry (ADR-0038) reads this to tell a user
	// who explicitly backed out to the meta level apart from a session
	// that was simply never saved; without it, restoring a persisted
	// root landing re-entered the lone root card on every relaunch.
	AtRootExplicit bool `json:"atRootExplicit"`
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
// exists: a fully-gone viewed card falls back to root; a tombstoned
// one (goal 0093) resolves to its own effective parent -- the same
// virtual-promotion walk every other read surface applies
// (atlas.EffectiveParentID) -- so a session parked inside a container
// deleted just before restart lands one level up, not all the way to
// root. A deleted (gone or tombstoned) open card is dropped. The
// caller never has to handle a stale id.
func (a *AtlasService) AtlasSession() AtlasSessionState {
	if os.Getenv(testAtlasSessionOffEnv) != "" {
		return AtlasSessionState{}
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	out := a.session
	byID := a.cardsByIDLocked()
	if out.ViewedID != "" {
		if c, ok := byID[out.ViewedID]; !ok {
			out.ViewedID = ""
		} else if !c.DeletedAt.IsZero() {
			out.ViewedID = atlas.EffectiveParentID(byID, c.ParentID)
		}
	}
	if out.OpenCardID != "" {
		if c, ok := byID[out.OpenCardID]; !ok || !c.DeletedAt.IsZero() {
			out.OpenCardID = ""
		}
	}
	if out.ActivePerspectiveID != "" && a.findPerspectiveLocked(out.ActivePerspectiveID) == -1 {
		out.ActivePerspectiveID = ""
	}
	return out
}
