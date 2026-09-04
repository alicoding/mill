//go:build !server

package systemaccent

import "github.com/wailsapp/wails/v3/pkg/application"

// read asks the running application for the platform accent. The call
// reaches AppKit (NSColor.controlAccentColor), whose main-thread
// affinity the toolkit does NOT enforce for this getter the way it does
// for its file-manager calls -- so the hop is made explicitly here
// rather than assumed from a sibling call's behavior.
func read() string {
	app := application.Get()
	if app == nil || app.Env == nil {
		return ""
	}
	return application.InvokeSyncWithResult(func() string {
		return app.Env.GetAccentColor()
	})
}
