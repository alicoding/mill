//go:build !server

package windowing

import "github.com/wailsapp/wails/v3/pkg/application"

// Entry kinds and node kinds, as they travel over the bridge. Only the
// renderer ever reads them, so they live beside it rather than beside
// the wire types.
const (
	menuKindMenu     = "menu"
	menuKindRoleMenu = "roleMenu"
	menuKindCommand  = "command"
	menuKindRole     = "role"
	menuKindSubmenu  = "submenu"
)

// menuRoles maps the projection's role names onto Wails3's own Role
// constants (pkg/application/roles.go). A name with no entry here is
// skipped rather than guessed at: an unknown role must not silently
// become a dead labelled item.
var menuRoles = map[string]application.Role{
	"services":         application.ServicesMenu,
	"hideOthers":       application.HideOthers,
	"showAll":          application.ShowAll,
	"edit":             application.EditMenu,
	"resetZoom":        application.ResetZoom,
	"zoomIn":           application.ZoomIn,
	"zoomOut":          application.ZoomOut,
	"toggleFullscreen": application.ToggleFullscreen,
	"minimise":         application.Minimise,
	"zoom":             application.Zoom,
	"bringAllToFront":  application.BringAllToFront,
	"reload":           application.Reload,
	"forceReload":      application.ForceReload,
	"openDevTools":     application.OpenDevTools,
}

// appNamedRoles are the three standard items whose LABEL carries the
// application's display name. Wails3 builds those from
// application.Options.Name at construction time and dereferences the
// global application to read it (pkg/application/menuitem_roles.go's
// NewAboutMenuItem/NewHideMenuItem/NewQuitMenuItem), which both panics
// with no live app and would spell the name the way the toolkit was
// configured rather than the way the menu bar shows it. Mill builds
// these three itself instead, sets the same Role, and lets the platform
// attach the standard responder for it -- on macOS the role, not the
// Go callback, is what supplies the selector
// (menuitem_selectors_darwin.go: About -> orderFrontStandardAboutPanel:,
// Hide -> hide:, Quit -> terminate:). Quit reaching terminate: is what
// keeps ⌘Q on the app's one termination gate
// (application.Options.ShouldQuit, main.go) rather than beside it.
var appNamedRoles = map[string]struct {
	role        application.Role
	label       func(appName string) string
	accelerator string
}{
	"about": {application.About, func(n string) string { return "About " + n }, ""},
	"hide":  {application.Hide, func(n string) string { return "Hide " + n }, "cmdorctrl+h"},
	"quit":  {application.Quit, func(n string) string { return "Quit " + n }, "cmdorctrl+q"},
}

// BuildMenu renders spec as a native menu tree and returns it alongside
// the command items by id, so enablement can be pushed later without
// rebuilding. onCommand is invoked with a command id when its item is
// chosen; it may be nil (a tree built only to be inspected).
//
// Pure with respect to the running app -- it constructs items but
// installs nothing, so it is exercised headless.
func BuildMenu(spec MenuSpec, onCommand func(id string)) (*application.Menu, map[string]*application.MenuItem) {
	root := application.NewMenu()
	items := map[string]*application.MenuItem{}
	for _, node := range spec.Menus {
		if node.Kind == menuKindRoleMenu {
			if role, ok := menuRoles[node.Role]; ok {
				root.AddRole(role)
			}
			continue
		}
		addGroups(root.AddSubmenu(node.Label), node.Label, node.Groups, onCommand, items)
	}
	return root, items
}

// addGroups fills menu with groups, separating consecutive non-empty
// bands. appName is the enclosing top-level menu's own label, which for
// the application menu IS the app's display name (appNamedRoles).
func addGroups(menu *application.Menu, appName string, groups [][]MenuEntry, onCommand func(id string), items map[string]*application.MenuItem) {
	first := true
	for _, group := range groups {
		if len(group) == 0 {
			continue
		}
		if !first {
			menu.AddSeparator()
		}
		first = false
		for _, entry := range group {
			addEntry(menu, appName, entry, onCommand, items)
		}
	}
}

func addEntry(menu *application.Menu, appName string, entry MenuEntry, onCommand func(id string), items map[string]*application.MenuItem) {
	switch entry.Kind {
	case menuKindRole:
		if named, ok := appNamedRoles[entry.Role]; ok {
			item := application.NewMenuItem(named.label(appName)).SetRole(named.role)
			if named.accelerator != "" {
				item.SetAccelerator(named.accelerator)
			}
			menu.Append(application.NewMenuFromItems(item))
			return
		}
		role, ok := menuRoles[entry.Role]
		if !ok {
			return
		}
		menu.AddRole(role)
		if entry.ReleaseAccelerator {
			if item := menu.FindByRole(role); item != nil {
				item.RemoveAccelerator()
			}
		}
	case menuKindSubmenu:
		addGroups(menu.AddSubmenu(entry.Label), appName, entry.Groups, onCommand, items)
	case menuKindCommand:
		id := entry.ID
		item := menu.Add(entry.Label).SetEnabled(entry.Enabled)
		if entry.Accelerator != "" {
			item.SetAccelerator(entry.Accelerator)
		}
		if onCommand != nil {
			item.OnClick(func(*application.Context) { onCommand(id) })
		}
		items[id] = item
	}
}

// commandItems is the id -> native item index of the currently
// installed menu, so SetMenuEnabled can flip an item without a rebuild.
// Written and read only from inside runMainThreadAction, i.e. only ever
// on the OS main thread, which is what makes a plain map safe here.
var commandItems map[string]*application.MenuItem

// InstallMenu replaces the whole application menu with spec, wiring
// every command item to emit MenuCommandEvent carrying its id. Reports
// whether a native menu was actually installed -- false with no live
// app, which is also how the page learns that no menu owns any
// accelerator and its own keydown dispatcher still owns them all.
func InstallMenu(spec MenuSpec) bool {
	installed := false
	runMainThreadAction("windowing.InstallMenu", func() {
		app := application.Get()
		if app == nil {
			return
		}
		menu, items := BuildMenu(spec, func(id string) {
			app.Event.Emit(MenuCommandEvent, MenuCommand{ID: id})
		})
		commandItems = items
		app.Menu.SetApplicationMenu(menu)
		menu.Update()
		installed = true
	})
	return installed
}

// SetMenuEnabled flips the live/dead state of already-installed command
// items -- ids absent from the installed menu are ignored, so the page
// can send whatever vector it computed without tracking what got
// rendered.
func SetMenuEnabled(enabled map[string]bool) {
	runMainThreadAction("windowing.SetMenuEnabled", func() {
		if len(commandItems) == 0 {
			return
		}
		for id, on := range enabled {
			if item, ok := commandItems[id]; ok {
				item.SetEnabled(on)
			}
		}
		if menu := applicationMenu(); menu != nil {
			menu.Update()
		}
	})
}
