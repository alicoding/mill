package settingssvc

import "github.com/alicoding/mill/internal/adapters/windowing"

// SetTrayPanelWindow wires the menu-bar status panel (docs/goals/0189)
// so it joins the aux-window family below. The tray itself owns showing
// and positioning the panel; registering it here exists so a hide that
// claims to cover every floating window actually does -- it was the one
// window HideAuxWindows never reached (docs/goals/0344).
//
//wails:ignore
func (s *SettingsService) SetTrayPanelWindow(w *windowing.Window) {
	s.mu.Lock()
	s.trayPanel = w
	s.mu.Unlock()
}

// auxWindowSlots returns every auxiliary window Mill creates -- the
// Quick Panel, the approval prompt, the run monitor, the capture
// window, the menu-bar status panel. One list, so a new floating
// window joins the family by being registered rather than by being
// remembered at each call site; a slot is nil until its window is
// wired (server mode wires none).
func (s *SettingsService) auxWindowSlots() []*windowing.Window {
	s.mu.Lock()
	defer s.mu.Unlock()
	return []*windowing.Window{s.panel, s.approvalPrompt, s.runMonitor, s.capture, s.trayPanel}
}

// HideAuxWindows orders every floating window Mill creates back out of
// sight (docs/goals/0301). Two callers, one property: none of them is
// ever on screen at a boundary the OS reads. At startup, because macOS
// restores a window it saw on screen when the process last ended, and
// an update's restart from the Quick Panel ends the process with the
// panel (and often the run monitor) showing; and right before a quit
// or restart Mill itself performs, so there is nothing on screen to
// bring back. Hiding an already-hidden window is a no-op in every
// case.
//
// This is the secondary defence, not the fix: the hides run in a
// goroutine racing shutdown, so the primary guarantee is that the
// windows are not restorable at all (windowing.WrapAuxWindow).
//
//wails:ignore
func (s *SettingsService) HideAuxWindows() {
	for _, w := range s.auxWindowSlots() {
		if w != nil {
			w.Hide()
		}
	}
}
