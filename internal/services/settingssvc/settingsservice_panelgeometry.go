package settingssvc

// Quick Panel position persistence (goal 0377): the panel now behaves
// like every precedent launcher (Raycast, Alfred, macOS Spotlight) --
// a dragged position sticks across summons instead of always
// re-centering. Reuses settingsservice_windowgeometry.go's own
// persist/watch/debounce facility (persistGeometry/watchGeometry),
// keyed separately from the main window so the two never collide.
// Supersedes settingsservice_panel.go's prior "deliberately never
// passed to WatchWindowGeometry" decision.
//
// Regression fix: the panel is an always-alive window (ADR-0033),
// created once, Hidden, and shown/hidden for the rest of the process's
// life -- it is never recreated. A saved position applied only via
// WebviewWindowOptions.X/Y at construction (auxwindows.go's
// newQuickPanelWindow) therefore only ever takes effect on the FIRST
// real Show() after launch; every native placement decision the window
// manager makes on that first show fires its own WindowDidMove, which
// WatchPanelGeometry then persisted as if it were a user's drag,
// corrupting the saved position for every later launch. presentPanel/
// presentPanelShow below apply the (clamped) saved position -- or
// Center() -- immediately before EVERY show, not just relying on
// construction; WatchPanelGeometry's own placement-grace guard
// (shouldPersistPanelMove) ignores the window manager's own settling
// move that follows.

import (
	"encoding/json"
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// panelGeometryPlacementGrace is the window, after presentPanel shows
// the panel, during which a WindowDidMove is treated as the window
// manager settling the panel into the position just requested (Center
// or SetPosition), not a user's drag -- the regression this file's own
// header describes. Reset on every show (markPanelShown).
const panelGeometryPlacementGrace = 250 * time.Millisecond

// SetPanelPositionClamp wires the live-screen clamp (goal 0377) --
// auxwindows.go's clampedPanelPosition, wrapping ClampPanelPosition
// against app.Screen -- so presentPanel and WatchPanelGeometry's own
// persist path can re-clamp without this package importing
// wails/v3/pkg/application itself (the ports/adapters boundary goal
// 0168 enforces). Called once from wireAuxWindows, alongside
// SetPanelWindow/WatchPanelGeometry.
//
//wails:ignore
func (s *SettingsService) SetPanelPositionClamp(fn func(x, y int) (int, int)) {
	s.mu.Lock()
	s.panelPositionClamp = fn
	s.mu.Unlock()
}

// markPanelShown records when the panel was last actually shown --
// WatchPanelGeometry's own shouldPersistPanelMove reads it.
func (s *SettingsService) markPanelShown() {
	s.mu.Lock()
	s.panelShownAt = time.Now()
	s.mu.Unlock()
}

// presentPanel is the Quick Panel's own show sequence: every door that
// shows the panel (TogglePanel's show branch, ShowPanel, and by
// extension the summon hotkey, which calls TogglePanel) funnels
// through this, so none of them can forget the position fix. Resolves
// the saved position and the live clamp under lock, then hands off to
// presentPanelShow -- the pure, fake-testable half of this sequence.
func (s *SettingsService) presentPanel(p *windowing.Window) {
	x, y, ok := s.LoadPanelGeometry()
	s.mu.Lock()
	clamp := s.panelPositionClamp
	s.mu.Unlock()
	s.markPanelShown()
	presentPanelShow(p, x, y, ok, clamp)
}

// presentPanelShow applies the saved (clamped) position -- or centers,
// first run/no saved position -- BEFORE showing the window, then runs
// the same bringFloatingToFront sequence every other floating window
// uses. Takes floatingWindow (settingsservice_presence.go), not
// *windowing.Window, so a fake can record the exact call order: this
// is the "SetPosition lands before Show" property the regression this
// file's own header describes was missing.
func presentPanelShow(p floatingWindow, x, y int, hasSaved bool, clamp func(x, y int) (int, int)) {
	if hasSaved {
		if clamp != nil {
			x, y = clamp(x, y)
		}
		p.SetPosition(x, y)
	} else {
		p.Center()
	}
	bringFloatingToFront(p)
}

// shouldPersistPanelMove decides whether a Quick Panel WindowDidMove
// event is a real user drag worth persisting, given the window's
// current visibility and how long ago presentPanel last showed it --
// the pure half of WatchPanelGeometry's own guard, unit-testable the
// same way summonShouldHideMain is (settingsservice_panel.go).
func shouldPersistPanelMove(visible bool, sinceShow time.Duration) bool {
	return visible && sinceShow >= panelGeometryPlacementGrace
}

// panelGeometryKey persists the Quick Panel's dragged position, same
// one-atomic-JSON-blob-per-key shape as windowGeometryKey. Only X/Y
// are ever read back (LoadPanelGeometry) -- the panel's Width/Height
// stay fixed (DisableResize, auxwindows.go), so reusing windowGeometry
// wholesale just carries constant values in those fields rather than
// needing a second, narrower struct.
const panelGeometryKey = "settings-quickpanel-geometry"

// LoadPanelGeometry returns the Quick Panel's persisted position, if
// any. Called from newQuickPanelWindow (auxwindows.go) before the
// native window exists, same "apply via WebviewWindowOptions' X/Y,
// there's no move-after-creation path that avoids a flash" reasoning
// LoadWindowGeometry's own doc comment gives for the main window.
// Go-internal wiring only.
//
//wails:ignore
func (s *SettingsService) LoadPanelGeometry() (x, y int, ok bool) {
	raw, isStr := s.store.Get(panelGeometryKey).(string)
	if !isStr || raw == "" {
		return 0, 0, false
	}
	var g windowGeometry
	if err := json.Unmarshal([]byte(raw), &g); err != nil {
		return 0, 0, false
	}
	return g.X, g.Y, true
}

// HasCustomPanelPosition reports whether a dragged position is
// currently saved -- panel.resetPosition's own enabled() predicate
// (shared/settingsCommands.ts): the command only offers to reset a
// position that differs from the default centered one. Bound so the
// MAIN window's command palette (a separate JS context from the panel
// that did the dragging) can read it; kept current there via the
// mill-data-changed announcement persistPanelGeometry/
// ResetPanelPosition below both emit.
func (s *SettingsService) HasCustomPanelPosition() bool {
	_, _, ok := s.LoadPanelGeometry()
	return ok
}

// persistPanelGeometry is WatchPanelGeometry's debounced persist
// target -- re-clamps into the live screen layout (panelPositionClamp,
// wired from auxwindows.go's clampedPanelPosition) before writing, so a
// move on a screen layout that's since shrunk never persists a
// position outside it, then stores the result and announces it over
// mill-data-changed (docs/adr/0025) so HasCustomPanelPosition's
// cross-window readers (the main window's palette) don't need to poll.
func (s *SettingsService) persistPanelGeometry(g windowGeometry) {
	s.mu.Lock()
	clamp := s.panelPositionClamp
	s.mu.Unlock()
	if clamp != nil {
		g.X, g.Y = clamp(g.X, g.Y)
	}
	s.persistGeometry(panelGeometryKey, g)
	dataevent.Emit("quickpanel-position", "")
}

// WatchPanelGeometry wires the Quick Panel's own WindowDidMove/
// WindowDidResize through the same shared debounce facility
// watchGeometry (settingsservice_windowgeometry.go) gives the main
// window, with the one guard the main window doesn't need (this file's
// own header): shouldPersistPanelMove filters a WindowDidMove at the
// moment it fires, before it ever arms the debounce timer, so the
// window manager's own post-show placement move never reaches
// persistPanelGeometry (which does its own re-clamp above). Called
// once from wireAuxWindows (auxwindows.go), right after SetPanelWindow.
//
//wails:ignore
func (s *SettingsService) WatchPanelGeometry() {
	s.mu.Lock()
	p := s.panel
	s.mu.Unlock()
	if p == nil {
		return
	}
	guard := func() bool {
		s.mu.Lock()
		shownAt := s.panelShownAt
		s.mu.Unlock()
		return shouldPersistPanelMove(p.IsVisible(), time.Since(shownAt))
	}
	watchGeometry(p, guard, s.persistPanelGeometry)
}

// ResetPanelPosition recenters the Quick Panel and clears its saved
// position -- panel.resetPosition's run() (shared/settingsCommands.ts).
// Center() (internal/adapters/windowing) issues its own WindowDidMove,
// which WatchPanelGeometry's debounced listener re-persists moments
// later with the recentered coordinate -- clearing the key here makes
// a re-summon inside that debounce window read as centered too, rather
// than depending on the debounce alone.
func (s *SettingsService) ResetPanelPosition() {
	s.mu.Lock()
	p := s.panel
	s.mu.Unlock()
	if p == nil {
		return
	}
	p.Center()
	s.clearPanelGeometry()
}

// clearPanelGeometry is ResetPanelPosition's own store write, split out
// so it shares the store.Set(key, "")-means-cleared convention
// millmcpservice_approval_migrate.go's legacy-key cleanup already uses,
// rather than inventing a delete-vs-set-empty distinction the settings.
// Store interface (Get/Set only, no Delete) doesn't offer anyway.
func (s *SettingsService) clearPanelGeometry() {
	if err := s.store.Set(panelGeometryKey, ""); err != nil {
		slog.Error("failed to clear quick panel geometry", "error", err)
	}
	dataevent.Emit("quickpanel-position", "")
}

// Rect is a screen work-area rectangle -- decoupled from Wails' own
// application.Rect at this package's ports/adapters boundary
// (architecture.md): auxwindows.go converts app.Screen.GetAll()/
// GetPrimary() into this shape at the one point that touches the real
// Screen API, so ClampPanelPosition's math needs nothing from the
// Wails SDK and stays unit-testable without a live app.
type Rect struct{ X, Y, Width, Height int }

// ClampPanelPosition moves a persisted Quick Panel position fully
// inside the WorkArea of whichever screen shares the larger part of
// the panel's own box with it (or primary when it shares none) --
// called once, from newQuickPanelWindow, before the panel's
// WebviewWindowOptions are built. Below-50%-overlap is the trigger,
// not "any pixel off screen": a panel mostly on one display but a
// sliver into a neighbor's edge shouldn't jump. Raycast, Alfred and
// macOS Spotlight never reopen off-screen after a display change
// (docs/goals/0377's own precedent). Deliberately NOT windowGeometry.
// valid()'s coarse ±50..10000 sanity bound: the panel is small and
// floating, so a saved position half off a since-removed external
// display should land fully on-screen, not just "not catastrophic."
func ClampPanelPosition(x, y, width, height int, screens []Rect, primary Rect) (int, int) {
	var zero Rect
	if len(screens) == 0 && primary == zero {
		return x, y
	}
	target := primary
	bestOverlap := 0
	for _, screen := range screens {
		overlap := overlapArea(x, y, width, height, screen)
		if overlap > bestOverlap {
			bestOverlap = overlap
			target = screen
		}
	}
	if panelArea := width * height; panelArea > 0 && bestOverlap*2 >= panelArea {
		return x, y
	}
	if target == zero {
		return x, y
	}
	const margin = 16
	minX, minY := target.X+margin, target.Y+margin
	maxX, maxY := target.X+target.Width-width-margin, target.Y+target.Height-height-margin
	if maxX < minX {
		maxX = minX
	}
	if maxY < minY {
		maxY = minY
	}
	return clampInt(x, minX, maxX), clampInt(y, minY, maxY)
}

// overlapArea is the pixel area shared between a width x height box at
// (x, y) and r -- 0 when they don't intersect at all.
func overlapArea(x, y, width, height int, r Rect) int {
	overlapW := min(x+width, r.X+r.Width) - max(x, r.X)
	overlapH := min(y+height, r.Y+r.Height) - max(y, r.Y)
	if overlapW <= 0 || overlapH <= 0 {
		return 0
	}
	return overlapW * overlapH
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
