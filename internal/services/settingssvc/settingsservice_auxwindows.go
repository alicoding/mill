package settingssvc

import "github.com/alicoding/mill/internal/adapters/windowing"

// HideAuxWindows orders every floating window Mill creates hidden at
// boot -- the Quick Panel, the approval prompt, the run monitor --
// back out of sight (docs/goals/0301). Two callers, one property:
// none of them is ever on screen at a boundary the OS reads. At
// startup, because macOS Resume restores a window it saw on screen
// when the process last ended, and an update's restart from the Quick
// Panel ends the process with the panel (and often the run monitor)
// showing; and right before a quit or restart Mill itself performs,
// so there is nothing on screen for Resume to bring back. Hiding an
// already-hidden window is a no-op in every case.
//
//wails:ignore
func (s *SettingsService) HideAuxWindows() {
	s.mu.Lock()
	p, a, r, c := s.panel, s.approvalPrompt, s.runMonitor, s.capture
	s.mu.Unlock()
	for _, w := range []*windowing.Window{p, a, r, c} {
		if w != nil {
			w.Hide()
		}
	}
}
