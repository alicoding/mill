//go:build server

package windowing

// Server mode has no menu bar: the app is reached through a browser,
// whose own menus belong to the browser. InstallMenu reporting false is
// the signal the page needs -- with no native menu owning any key
// equivalent, its own keydown dispatcher keeps every combo, exactly as
// it did before there was a menu bar at all.
func InstallMenu(MenuSpec) bool { return false }

// SetMenuEnabled has nothing to enable in server mode.
func SetMenuEnabled(map[string]bool) {}
