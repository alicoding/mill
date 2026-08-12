package settingssvc

import "testing"

// go test never runs against a live application.New() (see
// settingsservice_menu_test.go's own doc comment) -- SetApprovalPromptWindow
// is never called in a headless test process, so these cover the nil-guard
// paths only, same reasoning settingsservice_panel_test.go already
// established for TogglePanel/DismissPanel.

func TestShowApprovalPrompt_NilWindow_DoesNotPanic(t *testing.T) {
	s := newTestSettingsService(t)
	s.showApprovalPrompt() // SetApprovalPromptWindow was never called -- must not panic.
}

func TestDismissApprovalPrompt_NilWindow_DoesNotPanic(t *testing.T) {
	s := newTestSettingsService(t)
	s.DismissApprovalPrompt()
}
