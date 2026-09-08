package settingssvc

// Window position/size/maximized persistence -- split from
// settingsservice.go at the 500-line convention (architecture.md).

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/windowing"
)

// windowGeometryKey persists window position/size/maximized state --
// docs/SPEC.md §3.7's Update. Same one-atomic-JSON-blob-per-key shape
// as summonHotkeyKey.
const windowGeometryKey = "settings-window-geometry"

// windowGeometryDebounce batches rapid move/resize events (dragging a
// window fires dozens of them) into one write -- the same reasoning
// Electron's own de facto window-state-keeper convention uses
// (confirmed directly, docs/SPEC.md §3.7's research).
const windowGeometryDebounce = 500 * time.Millisecond

// windowGeometry is the persisted shape -- Fullscreen deliberately not
// tracked (see WatchWindowGeometry's own doc comment for why).
type windowGeometry struct {
	X, Y, Width, Height int
	Maximized           bool
}

// valid rejects a persisted position that would place the window
// somewhere very unlikely to be a real, currently-attached display.
// Wails3 (like Wails v2 before it -- wailsapp/wails#2739, confirmed
// directly) has no monitor-identity API: a window last positioned on a
// monitor that's since been disconnected can't be correctly relocated,
// only guarded against landing somewhere catastrophically inaccessible
// (e.g. a saved position from a since-removed external display sitting
// far off the primary screen's bounds). Not a full multi-monitor
// solution -- a known, accepted limitation, not silently pretended
// away (docs/SPEC.md §3.7's research).
func (g windowGeometry) valid() bool {
	return g.X > -50 && g.Y > -50 && g.X < 10000 && g.Y < 10000 && g.Width > 0 && g.Height > 0
}

// LoadWindowGeometry returns the persisted window geometry, if any and
// if it passes the basic off-screen guard above. Called from main.go
// before the window is created, so the saved position/size can be
// applied via WebviewWindowOptions' own X/Y/Width/Height/StartState
// fields -- there's no "move it after creation" path that avoids an
// initial flash at the default position/size. Go-internal wiring only,
// same as SetWindow/WatchWindowGeometry -- never meant to be called
// from the frontend (there's nothing for a window-geometry read to do
// there), just missed the //wails:ignore marker those two already have
// when this was first written.
//
//wails:ignore
func (s *SettingsService) LoadWindowGeometry() (x, y, width, height int, maximized bool, ok bool) {
	raw, isStr := s.store.Get(windowGeometryKey).(string)
	if !isStr || raw == "" {
		return 0, 0, 0, 0, false, false
	}
	var g windowGeometry
	if err := json.Unmarshal([]byte(raw), &g); err != nil || !g.valid() {
		return 0, 0, 0, 0, false, false
	}
	return g.X, g.Y, g.Width, g.Height, g.Maximized, true
}

// persistWindowGeometry is called from a debounced OnWindowEvent
// callback (WatchWindowGeometry below), not a request a caller is
// waiting on -- genuinely fire-and-forget background state, docs/goals/
// 0025 item 1's own named example. Logged rather than silently dropped
// so a persistent failure (e.g. a corrupted settings file) is at least
// diagnosable; a single failed write just means the window reopens at
// its default position/size next launch, not a data-loss-shaped bug.
func (s *SettingsService) persistWindowGeometry(g windowGeometry) {
	s.persistGeometry(windowGeometryKey, g)
}

// persistGeometry is persistWindowGeometry's key-parameterized core --
// goal 0377 extends this facility to a second window (the Quick Panel,
// settingsservice_panelgeometry.go), keyed separately from the main
// window's own windowGeometryKey so the two never collide or migrate
// each other's saved state.
func (s *SettingsService) persistGeometry(key string, g windowGeometry) {
	data, err := json.Marshal(g)
	if err != nil {
		slog.Error("failed to marshal window geometry", "key", key, "error", err)
		return
	}
	if err := s.store.Set(key, string(data)); err != nil {
		slog.Error("failed to persist window geometry", "key", key, "error", err)
	}
}

// WatchWindowGeometry wires w.OnGeometryChange (internal/adapters/
// windowing -- covers WindowDidMove/WindowDidResize/WindowMaximise/
// WindowUnMaximise/WindowRestore) to debounce-persist the window's
// position/size/maximized state on every real change. Called once from
// main.go,
// right after SetWindow. Fullscreen is deliberately not tracked:
// reapplying a persisted X/Y/Width/Height to a window that was last in
// fullscreen would be meaningless (macOS fullscreen occupies its own
// Space, with real, unresolved multi-monitor questions of its own,
// docs/SPEC.md §3.7) -- a real, named future gap rather than a guess.
//
//wails:ignore
func (s *SettingsService) WatchWindowGeometry() {
	s.mu.Lock()
	w := s.window
	s.mu.Unlock()
	if w == nil {
		return
	}
	watchGeometry(w, nil, s.persistWindowGeometry)
}

// watchGeometry is WatchWindowGeometry's key-agnostic core (goal 0377):
// debounce-persists whichever window it's given through whichever
// persist func the caller supplies -- WatchPanelGeometry
// (settingsservice_panelgeometry.go) reuses this for the Quick Panel
// rather than duplicating the debounce/OnGeometryChange wiring. A
// package-level function, not a method: it closes over nothing from
// *SettingsService, so the caller's own guard/persist closures are the
// only state it needs.
//
// guard, if non-nil, is consulted on every raw OnGeometryChange firing
// BEFORE the debounce timer is (re)armed -- returning false suppresses
// that event entirely rather than letting it (re)start the debounce.
// The main window passes nil (every move persists); the Quick Panel
// passes its own placement-grace check (settingsservice_panelgeometry.go's
// shouldPersistPanelMove) so the window manager's post-show settling
// move, which also fires WindowDidMove, never arms the timer at all.
func watchGeometry(w *windowing.Window, guard func() bool, persist func(windowGeometry)) {
	var timerMu sync.Mutex
	var timer *time.Timer
	doPersist := func() {
		x, y := w.Position()
		width, height := w.Size()
		persist(windowGeometry{X: x, Y: y, Width: width, Height: height, Maximized: w.IsMaximised()})
	}
	w.OnGeometryChange(func() {
		if guard != nil && !guard() {
			return
		}
		timerMu.Lock()
		defer timerMu.Unlock()
		if timer != nil {
			timer.Stop()
		}
		timer = time.AfterFunc(windowGeometryDebounce, doPersist)
	})
}
