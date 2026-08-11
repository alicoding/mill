//go:build server

package settingssvc

import "github.com/wailsapp/wails/v3/pkg/application"

// applicationMenu always returns nil in server mode: there is no
// native menu bar to suspend accelerators on (Wails3's own server-mode
// setApplicationMenu is a no-op, confirmed directly against
// application_server.go), and DefaultApplicationMenu itself doesn't
// even exist under this build tag -- every menu_*.go in Wails3's own
// pkg/application is //go:build !server. Suspend/RestoreMenuAccelerators
// (settingsservice_menu.go) degrade to a safe no-op when this returns
// nil.
func applicationMenu(app *application.App) *application.Menu {
	return nil
}

// onMainThread runs fn inline in server mode: there is no native run
// loop to dispatch to (application.InvokeSync would block forever), and
// applicationMenu returns nil above so fn's native menu ops are all
// short-circuited no-ops anyway. Mirrors the desktop counterpart's
// signature so settingsservice_menu.go stays build-tag-free.
func onMainThread(fn func()) {
	fn()
}
