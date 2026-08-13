package settingssvc

import "testing"

// go test never runs against a live application.New() (see
// settingsservice_menu_test.go), and the notify adapter's cgo send
// aborts in a headless test process -- so NotifyPendingApproval's full
// away branch is not callable here. This covers the nil-window guard
// only (same reasoning as settingsservice_approvalprompt_test.go); the
// real dock bounce is OS-bound and manual-only
// (.claude/rules/testing.md).

func TestDockBounceFn_NilWindow_DoesNotPanic(t *testing.T) {
	dockBounceFn(nil)
}
