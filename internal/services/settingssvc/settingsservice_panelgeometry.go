package settingssvc

// Quick Panel position persistence (goal 0377): the panel now behaves
// like every precedent launcher (Raycast, Alfred, macOS Spotlight) --
// a dragged position sticks across summons instead of always
// re-centering. Reuses settingsservice_windowgeometry.go's own
// persist/watch/debounce facility (persistGeometry/watchGeometry),
// keyed separately from the main window so the two never collide.
// Supersedes settingsservice_panel.go's prior "deliberately never
// passed to WatchWindowGeometry" decision.

import (
	"encoding/json"
	"log/slog"

	"github.com/alicoding/mill/internal/services/dataevent"
)

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
// target -- stores the position and announces it over mill-data-
// changed (docs/adr/0025) so HasCustomPanelPosition's cross-window
// readers (the main window's palette) don't need to poll.
func (s *SettingsService) persistPanelGeometry(g windowGeometry) {
	s.persistGeometry(panelGeometryKey, g)
	dataevent.Emit("quickpanel-position", "")
}

// WatchPanelGeometry wires the Quick Panel's own WindowDidMove/
// WindowDidResize the same debounced way WatchWindowGeometry does for
// the main window. Called once from wireAuxWindows (auxwindows.go),
// right after SetPanelWindow.
//
//wails:ignore
func (s *SettingsService) WatchPanelGeometry() {
	s.mu.Lock()
	p := s.panel
	s.mu.Unlock()
	if p == nil {
		return
	}
	watchGeometry(p, s.persistPanelGeometry)
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
