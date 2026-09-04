package windowing

// The native menu bar is a PROJECTION of the frontend's command
// registry (docs/goals/0332): the page decides what the menus contain
// and hands over this description; this package renders it and knows
// nothing about what any command means. A command item carries only an
// id -- clicking it emits MenuCommandEvent with that id, and the page
// runs the command.
//
// Standard items are expressed as ROLES, never as commands: the
// platform supplies their label, their localisation and their
// behaviour, and Mill must not reimplement Undo, Services or Zoom.

// MenuCommandEvent is emitted with a MenuCommand payload each time a
// command menu item is chosen.
const MenuCommandEvent = "menu:command"

// MenuCommand is MenuCommandEvent's payload -- the id of the command
// registry entry the chosen item stands for.
type MenuCommand struct {
	ID string
}

// MenuSpec is the whole menu bar, menus in bar order.
type MenuSpec struct {
	Menus []MenuNode
}

// MenuNode is one top-level menu. Kind is "menu" (Label plus Groups) or
// "roleMenu" (a menu the platform builds whole from Role, contents
// included -- Edit).
type MenuNode struct {
	Kind   string
	Label  string
	Role   string
	Groups [][]MenuEntry
}

// MenuEntry is one item. Kind is "command" (ID/Label/Accelerator/
// Enabled), "role" (Role), or "submenu" (Label plus nested Groups).
//
// Groups are separator bands: they render in order with a separator
// between consecutive bands, so a band is how the projection expresses
// "these belong together" without counting separators itself.
type MenuEntry struct {
	Kind        string
	ID          string
	Label       string
	Accelerator string
	Enabled     bool
	Role        string
	// ReleaseAccelerator strips the key equivalent the platform ships a
	// role with, so the combo reaches the page instead. The item stays
	// in the menu and stays clickable -- only its shortcut is given up.
	ReleaseAccelerator bool
	Groups             [][]MenuEntry
}
