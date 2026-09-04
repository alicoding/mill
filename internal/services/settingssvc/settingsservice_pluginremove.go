package settingssvc

import (
	"errors"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/filetrash"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// Uninstalling a plugin (goal 0321). It lives beside the plugin TRUST
// surface this service already owns (allow-list, consent, the content
// lock) rather than on the plugin service: removal is the last step of
// the same consent lifecycle -- the user withdraws a plugin's right to
// run and its folder goes with it.
//
// The folder is TRASHED, never deleted: the Trash is the undo. Mill's
// own undo journal is for canvas edits and never learns about this
// (goal 0321) -- putting the folder back is macOS's own "Put Back".

// PluginLocator answers where one installed plugin's folder is, and
// whether it is one of Mill's own bundled ones. Wired in the
// composition root over the plugin service's scan, so this package
// stays free of a dependency on it.
type PluginLocator func(id string) (dir string, builtin bool, found bool)

var (
	errRemovalUnavailable = errors.New("removing a plugin is not available in this build")
	errPluginNotInstalled = errors.New("no plugin with that id is installed")
	errPluginBuiltIn      = errors.New("plugins that ship with Mill cannot be removed")
)

// WirePluginRemoval hands the service its locator. Removal reports
// errRemovalUnavailable until it is called.
//
//wails:ignore
func (s *SettingsService) WirePluginRemoval(locate PluginLocator) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pluginLocator = locate
}

// RemovePlugin moves one installed plugin's folder to the Trash and
// returns where it landed, so the caller can say exactly where to look
// for it. Consent is withdrawn in the same step: a folder copied back
// in later is a NEW install and asks to be allowed again, which is the
// whole point of the install-time review.
//
// Contributions the plugin registered at load stay registered until
// the next load -- the same "plugins load at app start" contract
// disabling one already follows; objects it created keep rendering
// through the unknown-kind fallback face.
func (s *SettingsService) RemovePlugin(id string) (string, error) {
	s.mu.Lock()
	locate := s.pluginLocator
	s.mu.Unlock()
	if locate == nil {
		return "", errRemovalUnavailable
	}
	dir, builtin, found := locate(id)
	if !found {
		return "", fmt.Errorf("%w: %q", errPluginNotInstalled, id)
	}
	if builtin {
		return "", fmt.Errorf("%w: %q", errPluginBuiltIn, id)
	}
	dest, err := filetrash.Trash(dir)
	if err != nil {
		return "", err
	}
	if err := s.SetPluginAllowed(id, false); err != nil {
		return dest, err
	}
	dataevent.Emit("extension", id)
	return dest, nil
}
