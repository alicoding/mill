package windowing

import "github.com/wailsapp/wails/v3/pkg/application"

// OpenURL opens url (typically a file:// URL) via the OS file
// manager/default handler (Wails3's own BrowserManager.OpenURL, which
// shells out to the platform "open" equivalent) -- a no-op with no live
// app (headless test, server mode).
func OpenURL(url string) error {
	app := application.Get()
	if app == nil {
		return nil
	}
	return app.Browser.OpenURL(url)
}

// ConfigHome returns the OS-appropriate app-support/config-home
// directory (~/Library/Application Support on macOS) -- safe to call
// with no live app; application.Path resolves this from the OS itself,
// not from any App instance.
func ConfigHome() string {
	return application.Path(application.PathConfigHome)
}
