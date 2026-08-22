//go:build server

package windowing

import "github.com/wailsapp/wails/v3/pkg/application"

// applicationMenu always returns nil in server mode: there is no
// native menu bar to suspend accelerators on, and DefaultApplicationMenu
// itself doesn't even exist under this build tag. SuspendAccelerators/
// RestoreAccelerators/ReleaseRoleAccelerator all degrade to a safe
// no-op when this returns nil.
func applicationMenu() *application.Menu {
	return nil
}
