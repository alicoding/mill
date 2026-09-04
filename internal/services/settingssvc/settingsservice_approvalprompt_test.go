package settingssvc

import "testing"

// go test never runs against a live application.New() (see
// settingsservice_menu_test.go's own doc comment) -- SetApprovalPromptWindow
// is never called in a headless test process, so these cover the nil-guard
// paths only, same reasoning settingsservice_panel_test.go already
// established for TogglePanel/DismissPanel.

func TestShowApprovalPrompt_NilWindow_DoesNotPanic(t *testing.T) {
	s := newTestSettingsService(t)
	s.showApprovalPrompt("pending-1") // SetApprovalPromptWindow was never called -- must not panic.
}

// Regression: an empty prompt is a frameless window with no chrome and
// no dismiss, so nothing may show it without an item to present
// (docs/goals/0344).
func TestShouldShowApprovalPrompt_RequiresAnItem(t *testing.T) {
	if shouldShowApprovalPrompt("") {
		t.Error("no pending item still showed the prompt")
	}
	if !shouldShowApprovalPrompt("pending-1") {
		t.Error("a pending item did not show the prompt")
	}
}

func TestShowApprovalPrompt_NoItem_DoesNotPanic(t *testing.T) {
	s := newTestSettingsService(t)
	s.showApprovalPrompt("")
}

func TestDismissApprovalPrompt_NilWindow_DoesNotPanic(t *testing.T) {
	s := newTestSettingsService(t)
	s.DismissApprovalPrompt()
}
