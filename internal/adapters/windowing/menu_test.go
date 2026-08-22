package windowing

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestStripMenuAccelerators_NilMenu_DoesNotPanic(t *testing.T) {
	stripMenuAccelerators(nil, map[*application.MenuItem]string{})
}

// TestSuspendRestoreReleaseAccelerators_NoLiveApp_DoesNotPanic covers
// the honest ceiling for automated coverage here (go test never runs
// against a live application.New(), so applicationMenu() returns nil
// and every native mutation below is a no-op) -- the real native
// strip/restore/release only happens against a running desktop app
// (.claude/skills/run-mill, manual).
func TestSuspendRestoreReleaseAccelerators_NoLiveApp_DoesNotPanic(t *testing.T) {
	SuspendAccelerators()
	RestoreAccelerators()
	ReleaseRoleAccelerator(RoleCloseWindow)
}
