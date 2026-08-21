package settingssvc

import (
	"testing"
	"time"
)

// docs/adr/0033-quick-panel-second-window.md: TogglePanel/DismissPanel/
// OpenMainWindow all read s.panel/s.window under the lock and guard nil
// -- SetPanelWindow/SetWindow are never called in a headless Go test
// process (no real application.New() ever ran, so there's no real
// *application.WebviewWindow to construct), same reasoning
// TestShowWindow_NilWindow_DoesNotPanic already established for
// ShowWindow. application.Get() itself also returns nil outside a real
// running app (confirmed directly against the SDK source), so the
// OpenMainWindow/yieldFocusIfMainHidden event-emit/app-hide branches are
// exercised as no-ops here too, not skipped. newTestSettingsService is
// shared with settingsservice_menu_test.go (same package, same
// construction shape).

func TestTogglePanel_NilPanel_DoesNotPanic(t *testing.T) {
	s := newTestSettingsService(t)
	s.TogglePanel() // SetPanelWindow was never called -- must not panic.
}

func TestDismissPanel_NilPanel_DoesNotPanic(t *testing.T) {
	s := newTestSettingsService(t)
	s.DismissPanel()
}

func TestOpenMainWindow_NilWindow_DoesNotPanic(t *testing.T) {
	s := newTestSettingsService(t)
	s.OpenMainWindow("")
	s.OpenMainWindow("settings")
}

func TestYieldFocusIfMainHidden_NilWindow_DoesNotPanic(t *testing.T) {
	s := newTestSettingsService(t)
	s.yieldFocusIfMainHidden()
}

// TestSummonShouldHideMain covers all four cases of the pure guard
// TogglePanel now runs before showing the Quick Panel (the fix for the
// live-reproduced bug: a main window already open but backgrounded in a
// different app surfaced alongside the panel on summon). This is the
// one piece of the fix that doesn't need a real OS window, per
// .claude/rules/testing.md's own note that the condition-check
// function can get a pure unit test even when the full window-level
// behavior can't (registered manual-only in
// .claude/skills/run-mill/SKILL.md instead).
func TestSummonShouldHideMain(t *testing.T) {
	cases := []struct {
		name           string
		visible        bool
		focused        bool
		wantShouldHide bool
	}{
		{"not visible at all -- nothing to hide", false, false, false},
		{"not visible, somehow reported focused -- still nothing to hide", false, true, false},
		{"visible but not focused -- open in the background, exactly the bug", true, false, true},
		{"visible and focused -- user is actively in it, must not hide", true, true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := summonShouldHideMain(tc.visible, tc.focused)
			if got != tc.wantShouldHide {
				t.Errorf("summonShouldHideMain(visible=%v, focused=%v) = %v, want %v",
					tc.visible, tc.focused, got, tc.wantShouldHide)
			}
		})
	}
}

// The summon-grace guard (goal 0151): while a summon is in flight the
// focus-yield cascade must stay inert -- summoning from a background
// app momentarily loses the focus race, and without the grace that
// cascade hid the entire app.
func TestYieldFocus_InertDuringSummonGrace(t *testing.T) {
	s := newTestSettingsService(t)
	s.beginSummonGrace()
	// No panic, no app lookup crash headless -- and the grace flag is
	// the property under test: within the window the yield returns
	// before consulting any window state.
	s.yieldFocusIfMainHidden()
	s.mu.Lock()
	until := s.summonGraceUntil
	s.mu.Unlock()
	if !until.After(time.Now()) {
		t.Fatal("grace window must extend past now right after beginSummonGrace")
	}
}
