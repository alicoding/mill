package windowing

import "github.com/wailsapp/wails/v3/pkg/application"

// MacAppOptions is Mill's macOS archetype, declared rather than
// defaulted (goal 0188). It lives here rather than inline in main.go
// because this package already owns the platform seam, and because a
// declaration nobody can test is how this decision went wrong twice.
//
// AppKit offers two archetypes and Mill straddles them. A Regular app
// owns a real main window, a Dock icon and a ⌘-Tab entry. An Accessory
// app has no main window and lives in the menu bar. Mill is Regular --
// the main window is a primary working surface, not an afterthought --
// but it ALSO carries accessory behaviour: a tray, a summon hotkey, and
// a floating panel that hides on focus loss.
//
// ApplicationShouldTerminateAfterLastWindowClosed must therefore stay
// false, which is Wails' own default. True is the document-app answer,
// and it composes lethally with any path that empties the screen:
// hiding an already-open main window so it can't ride the panel's
// activation wave (goal 0035) leaves nothing visible, and AppKit then
// terminates the process -- a clean exit 0 with no panic and no crash
// report, which is why it read as a crash rather than a quit. The same
// flag already quit the app once before, when a window-closing
// accelerator fired mid hotkey-recording (settingsservice_menu.go's own
// comment records that instance).
//
// The invariant this encodes, and that archetype_test.go pins: Mill
// terminates only on an explicit user Quit -- the tray's Quit item or
// the application menu -- never as a side effect of a window becoming
// invisible. Background work (the scheduler, triggers, clipboard and
// filesystem watches) depends on the process outliving its windows.
func MacAppOptions() application.MacOptions {
	return application.MacOptions{
		ActivationPolicy: application.ActivationPolicyRegular,
		ApplicationShouldTerminateAfterLastWindowClosed: false,
	}
}
