package settingssvc

import (
	"time"

	"github.com/alicoding/mill/internal/adapters/windowing"
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
// was in, and macOS raises EVERY one of Mill's windows on that
// activation, not just the one just shown. The mitigation is now
// symmetric on both ends of the round trip: TogglePanel's own
// summonShouldHideMain guard (below) hides an already-open-but-
// backgrounded main window BEFORE showing the panel, so it never rides
// the activation wave into view; yieldFocusIfMainHidden hides the
// whole app the moment the panel is dismissed, if Mill's main window
// isn't what the user is now looking at either, so macOS hands focus
// back to the previous app instead of leaving Mill's (now empty)
// frontmost app state stuck on screen.
//
// App-level Show/Hide (as opposed to a *WebviewWindow's own Show/Hide)
// perform raw cgo calls straight into AppKit with no main-thread
// marshal of their own, unlike every WebviewWindow method -- AppKit
// aborts the process if touched off the main thread, and every caller
// below can run on a non-main goroutine (the summon hotkey's own
// callback goroutine, a bound RPC call from JS, or the WindowLostFocus
// listener SetPanelWindow registers below). windowing.ShowApp/HideApp
// (internal/adapters/windowing) own that marshal now, once, instead of
// each call site here carrying its own seam.

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
func (s *SettingsService) SetPanelWindow(w *windowing.Window) {
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
	w.OnLostFocus(func() {
		s.yieldFocusIfMainHidden()
	})
}

// yieldFocusIfMainHidden hides the whole app (windowing.HideApp)
// when the panel loses focus/is dismissed while Mill's main window
// isn't currently visible either -- i.e. there's nothing left of Mill's
// on screen to justify staying the frontmost app. If the main window IS
// visible (the user navigated into Mill itself via a panel row, or had
// it open already), this is a no-op: Mill legitimately keeps focus.
func (s *SettingsService) yieldFocusIfMainHidden() {
	s.mu.Lock()
	main := s.window
	grace := s.summonGraceUntil
	s.mu.Unlock()
	// A summon in flight must never be cancelled by its own focus
	// churn (goal 0151): summoning from a BACKGROUND app hides main,
	// then the panel can momentarily lose the focus race -- without
	// this grace, that cascade called app.Hide() and Mill vanished.
	if time.Now().Before(grace) {
		return
	}
	if main != nil && main.IsVisible() {
		return
	}
	windowing.HideApp()
}

// summonShouldHideMain reports whether TogglePanel's summon-side guard
// (below) should hide the main window before showing the panel, given
// the two pieces of state available at the instant the summon fires:
// whether main is currently visible, and whether it currently holds
// native keyboard focus (confirmed against the beta.4 source --
// WebviewWindow.IsFocused, webview_window.go, calls through to the
// macOS impl's isFocused, webview_window_darwin.go, which is literally
// `[nsWindow isKeyWindow]`). isKeyWindow is a real per-window OS
// signal, not an app-wide "is Mill active" flag: it can only be true
// if Mill is the frontmost app AND this specific window has keyboard
// focus. So the four cases resolve cleanly:
//   - not visible            -> false (nothing to hide either way)
//   - visible, not focused   -> true  (open in the background while a
//     different app -- e.g. a terminal -- was frontmost: exactly the
//     bug this guards against, an already-open main window riding the
//     panel's app-activation wave into view)
//   - visible, focused       -> false (the user was genuinely looking
//     at main and pressed summon deliberately -- hiding it out from
//     under them would be a worse bug than the one being fixed)
//
// Extracted as a pure function specifically so this condition -- the
// one part of the fix with no dependency on a real OS window -- gets a
// real unit test rather than joining the panel's other window-level
// behavior in the manual-only registry (.claude/skills/run-mill/SKILL.md).
func summonShouldHideMain(mainVisible, mainFocused bool) bool {
	return mainVisible && !mainFocused
}

// TogglePanel shows+focuses the Quick Panel if hidden, or dismisses it
// (via DismissPanel, so the same focus-yield mitigation applies) if
// already visible. Called from the summon hotkey's callback
// (settingsservice_summonhotkey.go's bindSummon) -- Go-internal only,
// no frontend surface calls this directly (the panel's own Escape
// dismissal is native via HideOnEscape; its explicit dismiss action
// calls DismissPanel below instead).
//
// Symmetric with yieldFocusIfMainHidden's dismiss-side mitigation:
// showing the panel activates Mill at the OS level (the same beta.4
// gap documented above), and macOS raises EVERY one of Mill's windows
// on activation, not just the one just shown. Without this guard, a
// main window that was already open but merely backgrounded (the user
// working in a different app) would surface right alongside the panel
// -- silently breaking the Quick Panel's own promise of reaching it
// "without leaving what you were doing." summonShouldHideMain decides
// whether that's actually what's happening, using the one real signal
// available (see its own doc comment); this only ever hides a window
// the user wasn't actively looking at a moment ago.
//
//wails:ignore
func (s *SettingsService) TogglePanel() {
	s.mu.Lock()
	p := s.panel
	main := s.window
	s.mu.Unlock()
	if p == nil {
		return
	}
	if p.IsVisible() {
		s.DismissPanel()
		return
	}
	if main != nil && summonShouldHideMain(main.IsVisible(), main.IsFocused()) {
		main.Hide()
	}
	s.beginSummonGrace()
	// Activate the app before showing the panel: macOS refuses key
	// status to a non-active app's window, and an unfocused floating
	// panel dies instantly to its own HideOnFocusLost (goal 0151).
	// App-level Show doesn't reverse the window-level Hide above.
	windowing.ShowApp()
	p.Show()
	p.Focus()
}

// beginSummonGrace opens the window during which yieldFocusIfMainHidden
// stays inert -- long enough to outlive activation/focus churn, short
// enough that a real dismiss right after summon still yields.
func (s *SettingsService) beginSummonGrace() {
	s.mu.Lock()
	s.summonGraceUntil = time.Now().Add(summonGraceWindow)
	s.mu.Unlock()
}

const summonGraceWindow = 1200 * time.Millisecond

// ShowPanel shows+focuses the Quick Panel -- the bound counterpart to
// TogglePanel (which stays //wails:ignore, Go-internal-only: the
// summon hotkey's own callback is the only caller that ever needs
// toggle-off semantics). docs/goals/0039's panel.applyClipboard command
// needs a way to bring the panel forward from JS when its bound hotkey
// fires while a DIFFERENT window (the main window) has keyboard focus --
// reuses TogglePanel's own show branch (including the
// summonShouldHideMain guard) rather than duplicating it, just without
// the dismiss-if-already-visible branch a toggle would need.
func (s *SettingsService) ShowPanel() {
	s.mu.Lock()
	p := s.panel
	main := s.window
	s.mu.Unlock()
	if p == nil {
		return
	}
	if p.IsVisible() {
		p.Focus()
		return
	}
	if main != nil && summonShouldHideMain(main.IsVisible(), main.IsFocused()) {
		main.Hide()
	}
	s.beginSummonGrace()
	// Activate the app before showing the panel: macOS refuses key
	// status to a non-active app's window, and an unfocused floating
	// panel dies instantly to its own HideOnFocusLost (goal 0151).
	// App-level Show doesn't reverse the window-level Hide above.
	windowing.ShowApp()
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
		windowing.Emit("mill-navigate", view)
	}
}
