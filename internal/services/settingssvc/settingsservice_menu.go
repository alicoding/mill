package settingssvc

import "github.com/wailsapp/wails/v3/pkg/application"

// SuspendMenuAccelerators strips every key-equivalent (accelerator) off
// the native application menu -- Close Window (Cmd+W), Quit (Cmd+Q),
// Undo/Copy/Paste, Reload, Zoom, etc. -- for as long as at least one
// hotkey recorder is armed.
//
// The bug this exists to fix, owner-hit directly: on macOS, NSMenu's
// performKeyEquivalent: intercepts a key-equivalent-matching keypress
// at the menu-bar layer BEFORE it ever reaches the webview's own
// keydown listener -- there is no "capture phase" for
// performKeyEquivalent the way there is for a DOM event, so nothing
// short of removing the accelerator itself stops Cocoa's own
// interception. useHotkeyCapture's recorder (frontend/src/composition/
// hotkeyCapture.ts) listens for keydown with e.preventDefault(), but
// that only stops the *webview* from acting on the key; it can't stop
// the OS from having already routed the same keypress to a matching
// NSMenuItem first. Pressing a combo that happens to collide with a
// reserved menu accelerator while the recorder was armed (the reported
// case: Cmd+Shift+W closed the window instead of being captured) never
// reaches the recorder's keydown handler at all -- and since
// Mac.ApplicationShouldTerminateAfterLastWindowClosed is true
// (main.go), closing the last window quits the whole app mid-recording.
//
// Cmd+Q (Quit) is deliberately included, not special-cased out: quitting
// mid-recording would be exactly as disruptive as the Cmd+Shift+W case
// this was built to fix, and there's no principled way to strip "only
// the one combo that would collide" without already knowing what the
// user is about to press -- which is the whole point of recording.
//
// Reference-counted (menuSuspendCount), not a bool: NodeInspector's
// canvas Inspector, TriggerRowLabel's inline per-row capture, and
// SettingsView's summon-hotkey recorder are three independent
// consumers that can all be mounted (and, in principle, mid-recording)
// at once -- the menu must stay suspended until every one of them has
// finished, not just whichever happens to call Restore last. Both
// directions are idempotent: a second Suspend while already suspended
// just bumps the count; Restore never drops the count below zero, so a
// stray extra cleanup call (e.g. an unmount racing a just-finished
// recording) is always safe.
//
// Lives on SettingsService, not TriggerService: this is app-shell/
// menu-bar state -- the same category as the tray icon, the summon
// hotkey, and launch-at-login (docs/SPEC.md §3.7) -- not workflow/
// trigger domain data. TriggerService's own hotkey methods
// (AssignHotkey/CheckConflict) stay scoped to per-workflow bindings and
// have no reason to know the native application menu exists.
//
// Server-mode-safe by construction, not just by nil-guard: every
// menu_*.go in Wails3's own pkg/application (the package that defines
// DefaultApplicationMenu, Menu.Update's native half, etc.) is
// //go:build !server -- calling those symbols unconditionally from this
// package would fail to *compile* under `-tags server`, not just
// misbehave at runtime. applicationMenu (settingsservice_menu_desktop.go
// / settingsservice_menu_server.go) is the same !server/server split
// internal/adapters/hotkey and internal/adapters/launchatlogin already
// use for the identical reason (no native run loop / no native menu
// bar in server mode) -- the server build's applicationMenu always
// returns nil, so both methods below degrade to a safe no-op there.
func (s *SettingsService) SuspendMenuAccelerators() {
	s.menuMu.Lock()
	defer s.menuMu.Unlock()
	s.menuSuspendCount++
	if s.menuSuspendCount > 1 {
		return // another recorder already suspended the menu
	}

	app := application.Get()
	if app == nil {
		return // no live app yet (e.g. a unit test) -- nothing to suspend
	}
	menu := applicationMenu(app)
	if menu == nil {
		return // server mode, or GetApplicationMenu unavailable -- see doc comment above
	}

	s.savedAccelerators = map[*application.MenuItem]string{}
	stripMenuAccelerators(menu, s.savedAccelerators)
	menu.Update()
}

// RestoreMenuAccelerators reverses SuspendMenuAccelerators -- see its
// doc comment for the full reasoning. Safe to call more times than
// Suspend was called (e.g. an unmount cleanup running after a recording
// already finished normally): the count floors at zero and a redundant
// call is a no-op.
func (s *SettingsService) RestoreMenuAccelerators() {
	s.menuMu.Lock()
	defer s.menuMu.Unlock()
	if s.menuSuspendCount == 0 {
		return
	}
	s.menuSuspendCount--
	if s.menuSuspendCount > 0 {
		return // another recorder is still active
	}

	saved := s.savedAccelerators
	s.savedAccelerators = nil
	if len(saved) == 0 {
		return
	}

	app := application.Get()
	if app == nil {
		return
	}
	for item, accel := range saved {
		item.SetAccelerator(accel)
	}
	if menu := applicationMenu(app); menu != nil {
		menu.Update()
	}
}

// stripMenuAccelerators walks every item in menu, recording each
// item's non-empty accelerator into out and clearing it. Recurses into
// submenus via the public ItemAt/IsSubmenu/GetSubmenu API --
// Menu.items itself is unexported, so there's no way to range over it
// directly from outside the application package. menu.Update() (the
// call that actually pushes the change to the native menu bar) is the
// caller's job, once, after every item in the tree has been visited --
// rebuilding per item would be wasteful, and would invalidate the impl
// pointers Update() itself walks mid-traversal.
// releasedMenuRoles are the native menu items whose accelerator is
// permanently stripped at startup by ReleaseMenuAccelerators, below --
// docs/goals/0016-keymap-system.md's keymap system found Mill's own
// ⌘W default command combo silently colliding with a role
// DefaultApplicationMenu() installs unconditionally, the exact
// performKeyEquivalent: bug class this file's Suspend/Restore pair
// already exists to work around for hotkey recording, just permanent
// instead of bracketing a recording session:
//   - File > Close (role CloseWindow, accelerator "Cmd+W") -- ⌘W is
//     the keymap's tab.close, not "close the window."
// The role is not removed from the menu, only its keyboard shortcut:
// File > Close still closes the window when chosen by mouse (a
// reasonable, distinct affordance from ⌘W's tab-close, matching native
// macOS "File > Close closes the current window/document" convention).
//
// View > Reload (role Reload, "Cmd+R") was released here too during
// initial implementation, since workflow.run's own default combo was
// briefly ⌘R -- reverted by explicit owner decision once workflow.run
// moved to ⌘↩ instead: ⌘R (and ⌘⇧R, ForceReload, already untouched)
// stay the native browser/dev-webview reload, the owner's own debug
// escape hatch. Left named here, not silently dropped, so a future
// reader doesn't wonder why Reload was ever a candidate.
var releasedMenuRoles = []application.Role{
	application.CloseWindow,
}

// ReleaseMenuAccelerators permanently strips releasedMenuRoles' native
// accelerators so their keypress falls through to the webview's own
// keydown listener (the command registry, App.tsx) instead of being
// intercepted by NSMenu's performKeyEquivalent: before it ever reaches
// the page -- see releasedMenuRoles' own doc comment for the bug this
// fixes and why (only) File > Close is in scope. Called once from
// main.go's ApplicationStarted handler, before any hotkey recorder
// could ever call SuspendMenuAccelerators -- this matters: Suspend's
// own stripMenuAccelerators only saves an item's accelerator into
// s.savedAccelerators when it's non-empty at the moment Suspend runs,
// so as long as this runs first, Restore can never put Close's
// accelerator back (it was never saved). Menu.FindByRole recurses the
// whole tree, so this doesn't need to walk into the File submenu
// itself. Desktop-only by construction, not a build tag: applicationMenu
// (settingsservice_menu_desktop.go / _server.go) already returns nil in
// server mode, degrading this to a safe no-op the same way Suspend/
// Restore already do.
//
//wails:ignore
func (s *SettingsService) ReleaseMenuAccelerators() {
	app := application.Get()
	if app == nil {
		return // no live app yet (e.g. a unit test) -- nothing to release
	}
	menu := applicationMenu(app)
	if menu == nil {
		return // server mode -- see applicationMenu's own doc comment
	}

	changed := false
	for _, role := range releasedMenuRoles {
		item := menu.FindByRole(role)
		if item == nil || item.GetAccelerator() == "" {
			continue
		}
		item.RemoveAccelerator()
		changed = true
	}
	if changed {
		menu.Update()
	}
}

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
