package settingssvc

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// The Quick Panel (docs/adr/0033-quick-panel-second-window.md) is a
// second, always-alive floating window -- a dedicated search+run
// surface, not the main window itself. The summon hotkey now TOGGLES
// this window (bindSummon, settingsservice_summonhotkey.go) rather than
// showing the main window directly, superseding §3.7's original
// "summon shows the main window" behavior.
//
// Wails3 has no first-party non-activating-panel mechanism at beta.4
// (confirmed against the pinned source -- NSWindow, not NSPanel;
// canBecomeKeyWindow is hardcoded YES; see ADR-0033 for the full
// research) -- showing ANY window, including this floating one,
// activates Mill and steals keyboard focus from whatever app the user
// was in. yieldFocusIfMainHidden below is the accepted mitigation: the
// moment the panel is dismissed, if Mill's own main window isn't what
// the user is now looking at either, hide the whole app so macOS hands
// focus back to the previous app instead of leaving Mill's (now empty)
// frontmost app state stuck on screen.

// SetPanelWindow wires the Quick Panel window, created by main.go right
// after every Service already exists (same "wire the rest after
// construction" shape as SetWindow). Registers the focus-yield
// mitigation directly rather than waiting for ApplicationStarted --
// OnWindowEvent only registers a Go-side callback, no native run loop
// dependency, same as WatchWindowGeometry's own direct-call timing.
//
// Deliberately never passed to WatchWindowGeometry -- the panel is a
// fixed-size, fixed-position (WindowCentered) utility window, not
// something whose geometry should persist across restarts the way the
// main window's does.
//
//wails:ignore
func (s *SettingsService) SetPanelWindow(w *application.WebviewWindow) {
	s.mu.Lock()
	s.panel = w
	s.mu.Unlock()

	// Every dismiss path funnels through the same underlying Hide()
	// call, confirmed directly against the beta.4 source: HideOnEscape
	// registers `window.Hide()` as its "escape" key binding,
	// HideOnFocusLost's own setupHideOnFocusLost listens for
	// WindowLostFocus and calls `w.Hide()`, and TogglePanel/DismissPanel
	// below call Hide() explicitly -- and ordering a key window out
	// resigns its key status on the way, so WindowLostFocus fires for
	// all three. One listener here covers every path; OnWindowEvent
	// appends listeners rather than replacing them (confirmed directly),
	// so this coexists cleanly with the built-in HideOnFocusLost
	// listener already registered via the window's own options.
	w.OnWindowEvent(events.Common.WindowLostFocus, func(*application.WindowEvent) {
		s.yieldFocusIfMainHidden()
	})
}

// yieldFocusIfMainHidden hides the whole app (application.Get().Hide())
// when the panel loses focus/is dismissed while Mill's main window
// isn't currently visible either -- i.e. there's nothing left of Mill's
// on screen to justify staying the frontmost app. If the main window IS
// visible (the user navigated into Mill itself via a panel row, or had
// it open already), this is a no-op: Mill legitimately keeps focus.
func (s *SettingsService) yieldFocusIfMainHidden() {
	s.mu.Lock()
	main := s.window
	s.mu.Unlock()
	if main != nil && main.IsVisible() {
		return
	}
	if app := application.Get(); app != nil {
		app.Hide()
	}
}

// TogglePanel shows+focuses the Quick Panel if hidden, or dismisses it
// (via DismissPanel, so the same focus-yield mitigation applies) if
// already visible. Called from the summon hotkey's callback
// (settingsservice_summonhotkey.go's bindSummon) -- Go-internal only,
// no frontend surface calls this directly (the panel's own Escape
// dismissal is native via HideOnEscape; its explicit dismiss action
// calls DismissPanel below instead).
//
//wails:ignore
func (s *SettingsService) TogglePanel() {
	s.mu.Lock()
	p := s.panel
	s.mu.Unlock()
	if p == nil {
		return
	}
	if p.IsVisible() {
		s.DismissPanel()
		return
	}
	p.Show()
	p.Focus()
}

// DismissPanel hides the Quick Panel and applies the focus-yield
// mitigation -- the bound RPC the panel's own frontend calls after a
// workflow run starts, or when its own Escape/dismiss affordance fires
// from JS rather than the native HideOnEscape key binding (e.g. a
// click outside the panel's content).
func (s *SettingsService) DismissPanel() {
	s.mu.Lock()
	p := s.panel
	s.mu.Unlock()
	if p != nil {
		p.Hide()
	}
	// Applied explicitly here too, not just via the WindowLostFocus
	// listener SetPanelWindow registers -- that listener fires off a
	// native notification whose exact timing relative to this call
	// returning isn't guaranteed, so DismissPanel stays correct on its
	// own. Idempotent either way (hiding an already-hidden app is a
	// no-op), so the two never conflict.
	s.yieldFocusIfMainHidden()
}

// OpenMainWindow shows/restores/focuses Mill's main window (ShowWindow's
// existing sequence) and, when view is non-empty, emits 'mill-navigate'
// so App.tsx switches to that view -- the Quick Panel's "Open Mill" and
// "Open Settings" rows both call this. Always dismisses the panel
// first, so jumping to the main window never leaves the floating panel
// sitting open behind it.
func (s *SettingsService) OpenMainWindow(view string) {
	s.mu.Lock()
	p := s.panel
	s.mu.Unlock()
	if p != nil {
		p.Hide()
	}
	s.ShowWindow()
	if view != "" {
		if app := application.Get(); app != nil {
			app.Event.Emit("mill-navigate", view)
		}
	}
}
