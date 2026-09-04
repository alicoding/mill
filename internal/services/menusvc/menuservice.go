// Package menusvc is the bound service the frontend pushes the native
// menu bar through (docs/goals/0332). The menu bar is a projection of
// the frontend's command registry: the page computes what every menu
// contains, this service hands it to the windowing adapter, and Go
// never learns what any command means -- a chosen item emits its id
// back to the page, which runs the command.
package menusvc

import "github.com/alicoding/mill/internal/adapters/windowing"

// MenuService installs the application menu and keeps its items' live/
// dead state in step with the page. Stateless: the installed menu lives
// in the windowing adapter, on the OS main thread.
type MenuService struct{}

// New returns the service main.go binds.
func New() *MenuService { return &MenuService{} }

// Install replaces the application menu with spec. Returns whether a
// native menu bar actually took it -- false in server mode and before
// the desktop app exists, which is how the page knows no menu item owns
// a keyboard shortcut and its own dispatcher still owns them all.
func (s *MenuService) Install(spec windowing.MenuSpec) bool {
	return windowing.InstallMenu(spec)
}

// SetEnabled updates which command items are choosable, keyed by
// command id. A disabled item is also inert to its own keyboard
// shortcut, which is what keeps a surface-scoped shortcut from firing
// off its surface.
func (s *MenuService) SetEnabled(enabled map[string]bool) {
	windowing.SetMenuEnabled(enabled)
}
