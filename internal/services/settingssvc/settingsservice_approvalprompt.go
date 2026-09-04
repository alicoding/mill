package settingssvc

import "github.com/alicoding/mill/internal/adapters/windowing"

// The floating approval prompt (docs/goals/0023-attention-escalation.md
// item 1, ADR-0033's second-window mechanism reused rather than
// re-derived): the incoming-call/askpass pattern -- an always-on-top
// mini-window Mill draws over whatever app is focused, the moment a
// decision parks while the presence gate (settingsservice_attention.go's
// isAway) says the user is away. Unlike the Quick Panel, this window is
// shown by the BACKEND itself (NotifyPendingApproval), never toggled by
// a hotkey -- and deliberately does NOT use HideOnFocusLost (set in
// main.go's window options): a decision prompt must not vanish just
// because focus wandered (the VS Code severity-notification rule --
// never auto-dismiss something that needs a decision). Escape
// (HideOnEscape) is its one native, explicit dismiss path.

// SetApprovalPromptWindow wires the approval-prompt window, created by
// main.go right after every Service already exists (same "wire the
// rest after construction" shape as SetWindow/SetPanelWindow). Reuses
// SetPanelWindow's own focus-yield-on-dismiss mitigation (yieldFocusIfMainHidden)
// -- Escape's own Hide() resigns key status the same way TogglePanel's
// explicit Hide() does, so WindowLostFocus fires for the one dismiss
// path this window has.
//
//wails:ignore
func (s *SettingsService) SetApprovalPromptWindow(w *windowing.Window) {
	s.mu.Lock()
	s.approvalPrompt = w
	s.mu.Unlock()

	w.OnLostFocus(func() {
		s.yieldFocusIfMainHidden()
	})
}

// showApprovalPrompt shows the floating approval prompt -- Show only,
// never an explicit Focus() call beyond whatever activation Show()
// itself unavoidably causes (ADR-0033's documented compromise: no
// non-activating-panel mechanism exists at the pinned Wails3 version).
// windowing.ShowApp() still runs first, same reasoning as
// bringFloatingToFront (settingsservice_presence.go): a decision can
// park while Mill is app-hidden (windowing.HideApp, the focus-yield
// mitigation), and ordering the window in without un-hiding the app
// first would leave the prompt invisible -- the same composition gap
// goal 0186 found in ShowWindow. Kept as its own call rather than
// reusing bringFloatingToFront: that helper's explicit Focus() would
// contradict the Show-only rule above.
// Called exclusively from NotifyPendingApproval, the ONE presence-gate
// decision point (settingsservice_attention.go) -- never independently,
// so "notify" and "show the prompt" always agree about whether the
// user is away.
func (s *SettingsService) showApprovalPrompt(itemID string) {
	if !shouldShowApprovalPrompt(itemID) {
		return
	}
	s.mu.Lock()
	p := s.approvalPrompt
	s.mu.Unlock()
	if p == nil {
		return
	}
	windowing.ShowApp()
	p.Show()
}

// shouldShowApprovalPrompt reports whether there is an item worth
// putting the prompt on screen for. An empty prompt is a frameless
// window with no chrome and no dismiss sitting on top of whatever the
// user is doing (docs/goals/0344), so nothing may show it without an
// item to present. The frontend keeps its own dismiss-when-empty
// fallback for the item that resolves elsewhere between the show and
// the window's first fetch.
func shouldShowApprovalPrompt(itemID string) bool { return itemID != "" }

// DismissApprovalPrompt hides the floating approval prompt and applies
// the same focus-yield mitigation DismissPanel already uses -- called
// by the prompt's own frontend once the last pending item resolves (or
// there's nothing left to show on mount), the DismissPanel-equivalent
// RPC for this window.
func (s *SettingsService) DismissApprovalPrompt() {
	s.mu.Lock()
	p := s.approvalPrompt
	s.mu.Unlock()
	if p != nil {
		p.Hide()
	}
	s.yieldFocusIfMainHidden()
}
