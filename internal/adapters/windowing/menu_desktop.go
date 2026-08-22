//go:build !server

package windowing

import "github.com/wailsapp/wails/v3/pkg/application"

// applicationMenu returns the app's currently-installed application
// menu, lazily installing Wails3's own DefaultApplicationMenu() via
// SetApplicationMenu the first time nothing has been installed yet --
// on darwin, application.App.Run() auto-builds and installs a default
// menu the moment nothing was set, but never stores the *Menu it
// created back onto the App struct, so GetApplicationMenu() returns nil
// forever unless something calls SetApplicationMenu explicitly.
// Returns nil with no live app. !server-only because every menu_*.go in
// Wails3's own pkg/application (DefaultApplicationMenu among them) is
// itself //go:build !server.
func applicationMenu() *application.Menu {
	app := application.Get()
	if app == nil {
		return nil
	}
	if menu := app.Menu.GetApplicationMenu(); menu != nil {
		return menu
	}
	menu := application.DefaultApplicationMenu()
	app.Menu.SetApplicationMenu(menu)
	return menu
}
