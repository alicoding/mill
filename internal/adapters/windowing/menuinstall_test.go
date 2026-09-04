//go:build !server

package windowing

import (
	"slices"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// labelsOf flattens a menu to its items' labels, with "-" standing in
// for a separator, so a test can assert the whole shape of a band
// layout in one comparison.
func labelsOf(menu *application.Menu) []string {
	var out []string
	for i := 0; ; i++ {
		item := menu.ItemAt(i)
		if item == nil {
			break
		}
		if item.IsSeparator() {
			out = append(out, "-")
			continue
		}
		out = append(out, item.Label())
	}
	return out
}

func submenuNamed(t *testing.T, menu *application.Menu, label string) *application.Menu {
	t.Helper()
	for i := 0; ; i++ {
		item := menu.ItemAt(i)
		if item == nil {
			t.Fatalf("no submenu labelled %q in %v", label, labelsOf(menu))
		}
		if item.IsSubmenu() && item.Label() == label {
			return item.GetSubmenu()
		}
	}
}

func testSpec() MenuSpec {
	return MenuSpec{Menus: []MenuNode{
		{Kind: menuKindMenu, Label: "Mill", Groups: [][]MenuEntry{
			{{Kind: menuKindRole, Role: "about"}, {Kind: menuKindCommand, ID: "update.check", Label: "Check for updates…", Enabled: true}},
			{{Kind: menuKindCommand, ID: "settings.open", Label: "Settings…", Accelerator: "cmdorctrl+,", Enabled: true}},
			{{Kind: menuKindRole, Role: "services"}},
			{{Kind: menuKindRole, Role: "hide"}, {Kind: menuKindRole, Role: "hideOthers"}, {Kind: menuKindRole, Role: "showAll"}},
			{{Kind: menuKindRole, Role: "quit"}},
		}},
		{Kind: menuKindRoleMenu, Label: "Edit", Role: "edit"},
		{Kind: menuKindMenu, Label: "Window", Groups: [][]MenuEntry{
			{{Kind: menuKindRole, Role: "minimise"}, {Kind: menuKindRole, Role: "zoom"}},
			// An empty band must not leave a stray separator behind.
			{},
			{{Kind: menuKindRole, Role: "bringAllToFront"}},
		}},
		{Kind: menuKindMenu, Label: "Help", Groups: [][]MenuEntry{
			{{Kind: menuKindCommand, ID: "view.docs", Label: "Mill help", Enabled: true}},
			{{Kind: menuKindSubmenu, Label: "Developer", Groups: [][]MenuEntry{
				{{Kind: menuKindRole, Role: "reload"}, {Kind: menuKindRole, Role: "forceReload"}},
			}}},
		}},
	}}
}

func TestBuildMenu_RendersBandsSeparatorsAndRoles(t *testing.T) {
	menu, items := BuildMenu(testSpec(), nil)

	if got, want := labelsOf(menu), []string{"Mill", "Edit", "Window", "Help"}; !equalStrings(got, want) {
		t.Fatalf("top-level menus = %v, want %v", got, want)
	}

	millMenu := submenuNamed(t, menu, "Mill")
	// The three app-named roles take the enclosing menu's label as the
	// app's display name, and the bands are separated exactly once each.
	want := []string{
		"About Mill", "Check for updates…",
		"-", "Settings…",
		"-", "Services",
		"-", "Hide Mill", "Hide Others", "Show All",
		"-", "Quit Mill",
	}
	if got := labelsOf(millMenu); !equalStrings(got, want) {
		t.Errorf("Mill menu = %v, want %v", got, want)
	}

	// Edit is the platform's own menu, contents included.
	editMenu := submenuNamed(t, menu, "Edit")
	if labelsOf(editMenu)[0] != "Undo" {
		t.Errorf("Edit menu = %v, want the platform's own Undo first", labelsOf(editMenu))
	}

	windowMenu := submenuNamed(t, menu, "Window")
	if got, w := labelsOf(windowMenu), []string{"Minimize", "Zoom", "-", "Bring All to Front"}; !equalStrings(got, w) {
		t.Errorf("Window menu = %v, want %v (an empty band renders nothing)", got, w)
	}

	developer := submenuNamed(t, submenuNamed(t, menu, "Help"), "Developer")
	if got, w := labelsOf(developer), []string{"Reload", "Force Reload"}; !equalStrings(got, w) {
		t.Errorf("Help > Developer = %v, want %v", got, w)
	}

	if got := items["settings.open"].GetAccelerator(); got != "Cmd+," {
		t.Errorf("settings.open accelerator = %q, want %q", got, "Cmd+,")
	}
	for _, id := range []string{"update.check", "settings.open", "view.docs"} {
		if items[id] == nil {
			t.Errorf("command item %q not indexed by id", id)
		}
	}
}

// A submenu carrying actual command items, not just roles (goal 0335's
// File > New… seat) -- Help > Developer above only ever nests roles,
// so this pins that a nested command still gets a real click handler
// and a slot in the returned items index, the same as a top-level one.
func TestBuildMenu_SubmenuWithCommandItems(t *testing.T) {
	spec := MenuSpec{Menus: []MenuNode{{Kind: menuKindMenu, Label: "File", Groups: [][]MenuEntry{
		{{Kind: menuKindSubmenu, Label: "New…", Groups: [][]MenuEntry{
			{
				{Kind: menuKindCommand, ID: "configure.new.lists", Label: "New list", Enabled: true},
				{Kind: menuKindCommand, ID: "configure.new.mcpservers", Label: "New MCP server", Enabled: false},
			},
		}}},
	}}}}
	menu, items := BuildMenu(spec, func(string) {})

	newMenu := submenuNamed(t, submenuNamed(t, menu, "File"), "New…")
	if got, want := labelsOf(newMenu), []string{"New list", "New MCP server"}; !equalStrings(got, want) {
		t.Fatalf("File > New… = %v, want %v", got, want)
	}
	if items["configure.new.lists"] == nil || items["configure.new.mcpservers"] == nil {
		t.Fatal("nested command items not indexed by id")
	}
	if !items["configure.new.lists"].Enabled() || items["configure.new.mcpservers"].Enabled() {
		t.Error("nested command items did not carry their own Enabled through")
	}
}

func TestBuildMenu_DisabledCommandItem(t *testing.T) {
	spec := MenuSpec{Menus: []MenuNode{{Kind: menuKindMenu, Label: "File", Groups: [][]MenuEntry{
		{{Kind: menuKindCommand, ID: "tab.close", Label: "Close tab", Enabled: false}},
	}}}}
	_, items := BuildMenu(spec, nil)
	if items["tab.close"].Enabled() {
		t.Error("tab.close item is enabled, want disabled -- the projection said so")
	}
}

func TestBuildMenu_UnknownRoleIsSkipped(t *testing.T) {
	spec := MenuSpec{Menus: []MenuNode{{Kind: menuKindMenu, Label: "View", Groups: [][]MenuEntry{
		{{Kind: menuKindRole, Role: "notARole"}, {Kind: menuKindRole, Role: "zoomIn"}},
	}}}}
	menu, _ := BuildMenu(spec, nil)
	if got, want := labelsOf(submenuNamed(t, menu, "View")), []string{"Zoom In"}; !equalStrings(got, want) {
		t.Errorf("View menu = %v, want %v -- an unknown role must not become a dead item", got, want)
	}
}

// Regression: a menu built before the app is running must not push
// itself at a platform menu bar that does not exist yet. Menu.Update
// is guarded on the toolkit's own running flag, and BuildMenu itself
// touches no live app.
func TestBuildMenu_UpdateOffAppIsSafe(t *testing.T) {
	menu, _ := BuildMenu(testSpec(), nil)
	menu.Update()
}

func TestInstallMenu_NoLiveApp_ReportsNotInstalled(t *testing.T) {
	if InstallMenu(testSpec()) {
		t.Error("InstallMenu reported installed with no live app -- the page would then hand the menu bar its shortcuts")
	}
	SetMenuEnabled(map[string]bool{"tab.close": false}) // must not panic
}

// stripMenuAccelerators is what SuspendAccelerators walks the installed
// tree with while a hotkey recorder is armed. Mill's own menu bar nests
// (Help > Developer), so a walk that stopped at the top level would
// leave a nested key equivalent live and let it swallow the combo the
// user is trying to record.
func TestStripMenuAccelerators_ReachesNestedSubmenus(t *testing.T) {
	root := application.NewMenu()
	top := root.AddSubmenu("Help")
	top.Add("Shallow").SetAccelerator("cmdorctrl+1")
	nested := top.AddSubmenu("Developer")
	deep := nested.Add("Deep").SetAccelerator("cmdorctrl+2")

	stash := map[*application.MenuItem]string{}
	stripMenuAccelerators(root, stash)

	if got := deep.GetAccelerator(); got != "" {
		t.Errorf("nested item still holds accelerator %q after the strip", got)
	}
	if len(stash) != 2 {
		t.Fatalf("stashed %d accelerators, want 2 (one shallow, one nested)", len(stash))
	}
	if stash[deep] != "Cmd+2" {
		t.Errorf("nested item stashed as %q, want %q -- Restore would not put it back", stash[deep], "Cmd+2")
	}
}

func equalStrings(a, b []string) bool {
	return slices.Equal(a, b)
}

// Regression: the platform ships View's zoom roles with ⌘0/⌘+/⌘-,
// which are Mill's own Go-to-Home and canvas-zoom combos. A role that
// asked to release its accelerator keeps its item and loses only the
// key equivalent, so the page's own listener sees the keypress.
func TestBuildMenu_RoleReleasesItsAccelerator(t *testing.T) {
	spec := MenuSpec{Menus: []MenuNode{{Kind: menuKindMenu, Label: "View", Groups: [][]MenuEntry{
		{{Kind: menuKindRole, Role: "zoomIn", ReleaseAccelerator: true}, {Kind: menuKindRole, Role: "toggleFullscreen"}},
	}}}}
	menu, _ := BuildMenu(spec, nil)
	view := submenuNamed(t, menu, "View")
	if got := view.ItemAt(0).GetAccelerator(); got != "" {
		t.Errorf("Zoom In still holds accelerator %q -- ⌘+ would never reach the canvas", got)
	}
	if got := view.ItemAt(1).GetAccelerator(); got == "" {
		t.Error("Toggle Full Screen lost its accelerator, but never asked to")
	}
}
