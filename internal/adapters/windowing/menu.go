package windowing

import "github.com/wailsapp/wails/v3/pkg/application"

// Role names a native application-menu role (e.g. the File > Close
// item) whose accelerator ReleaseRoleAccelerator can permanently strip.
type Role = application.Role

// RoleCloseWindow is the one role Mill currently releases at startup
// (settingssvc's ReleaseMenuAccelerators) -- see that call site's own
// doc comment for why only File > Close.
const RoleCloseWindow = application.CloseWindow

// acceleratorStash holds the accelerators SuspendAccelerators most
// recently stripped, so RestoreAccelerators can put them back. A
// package-level var, not per-call state: Mill only ever suspends the
// ONE native application menu, and the caller (settingssvc's
// reference-counted Suspend/Restore pair) already guarantees at most
// one suspend is active at a time.
var acceleratorStash map[*application.MenuItem]string

// SuspendAccelerators strips every key-equivalent off the native
// application menu -- a no-op with no live app or no native menu
// (server mode; applicationMenu's build-tag split, below). Native NSMenu
// mutation must run on the main thread, so this always goes through
// runMainThreadAction.
func SuspendAccelerators() {
	runMainThreadAction("windowing.SuspendAccelerators", func() {
		menu := applicationMenu()
		if menu == nil {
			return
		}
		acceleratorStash = map[*application.MenuItem]string{}
		stripMenuAccelerators(menu, acceleratorStash)
		menu.Update()
	})
}

// RestoreAccelerators reverses SuspendAccelerators -- a no-op if
// nothing is currently stashed (Suspend was never called, or Restore
// already ran).
func RestoreAccelerators() {
	saved := acceleratorStash
	acceleratorStash = nil
	if len(saved) == 0 {
		return
	}
	runMainThreadAction("windowing.RestoreAccelerators", func() {
		for item, accel := range saved {
			item.SetAccelerator(accel)
		}
		if menu := applicationMenu(); menu != nil {
			menu.Update()
		}
	})
}

// ReleaseRoleAccelerator permanently strips role's native accelerator
// so its keypress falls through to the webview's own keydown listener
// instead of being intercepted by NSMenu's performKeyEquivalent: before
// it ever reaches the page. The role itself is not removed from the
// menu, only its keyboard shortcut.
func ReleaseRoleAccelerator(role Role) {
	runMainThreadAction("windowing.ReleaseRoleAccelerator", func() {
		menu := applicationMenu()
		if menu == nil {
			return
		}
		item := menu.FindByRole(role)
		if item == nil || item.GetAccelerator() == "" {
			return
		}
		item.RemoveAccelerator()
		menu.Update()
	})
}

// stripMenuAccelerators walks every item in menu, recording each
// item's non-empty accelerator into out and clearing it. Recurses into
// submenus via the public ItemAt/IsSubmenu/GetSubmenu API -- Menu.items
// itself is unexported. menu.Update() (the call that actually pushes
// the change to the native menu bar) is the caller's job, once, after
// every item in the tree has been visited.
func stripMenuAccelerators(menu *application.Menu, out map[*application.MenuItem]string) {
	if menu == nil {
		return
	}
	for i := 0; ; i++ {
		item := menu.ItemAt(i)
		if item == nil {
			break // ItemAt returns nil past the last item -- no public Len()
		}
		if item.IsSubmenu() {
			stripMenuAccelerators(item.GetSubmenu(), out)
			continue
		}
		if accel := item.GetAccelerator(); accel != "" {
			out[item] = accel
			item.RemoveAccelerator()
		}
	}
}
