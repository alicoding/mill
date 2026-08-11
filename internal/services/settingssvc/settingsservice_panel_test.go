package settingssvc

import (
	"testing"
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
