//go:build !server

package settingssvc

import "github.com/wailsapp/wails/v3/pkg/application"

// applicationMenu returns the app's currently-installed application
// menu, lazily installing Wails3's own DefaultApplicationMenu() via
// SetApplicationMenu the first time nothing has been installed yet.
//
// main.go never calls app.Menu.SetApplicationMenu itself -- on darwin,
// application.App.Run() already builds and installs a default menu
// automatically (application_darwin.go's setApplicationMenu(nil)
// branch) the moment nothing was set, confirmed directly against the
// installed Wails3 SDK source. But that automatic build never stores
// the *Menu it created back onto the App struct (only the raw native
// NSMenu pointer survives, inside the darwin-only impl), so
// app.Menu.GetApplicationMenu() returns nil forever unless *something*
// calls SetApplicationMenu explicitly -- there is no Go-level handle to
// mutate. Calling it here, lazily, on first use rather than from
// main.go's startup path keeps this capability self-contained (no
// change to main.go's already-verified startup wiring) and produces an
// identical menu either way -- DefaultApplicationMenu() is exactly what
// darwin would have auto-built regardless.
//
// !server-only because every menu_*.go in Wails3's own pkg/application
// (DefaultApplicationMenu among them) is itself //go:build !server --
// see settingsservice_menu.go's doc comment for the full reasoning and
// the internal/adapters/hotkey / internal/adapters/launchatlogin
// precedent this split matches.
func applicationMenu(app *application.App) *application.Menu {
	if menu := app.Menu.GetApplicationMenu(); menu != nil {
		return menu
	}
	menu := application.DefaultApplicationMenu()
	app.Menu.SetApplicationMenu(menu)
	return menu
}
