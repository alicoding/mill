package settingssvc

import (
	"errors"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/filetrash"
	"github.com/alicoding/mill/internal/domain/usererror"
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

// PluginMutation serializes a package mutation with installer recovery.
type PluginMutation func(id string, action func(dir string, builtin bool, found bool) error) error

// PluginTrash is the recoverable package-removal adapter.
type PluginTrash func(path string) (destination string, err error)

var (
	errRemovalUnavailable = errors.New("removing a plugin is not available in this build")
	errPluginNotInstalled = errors.New("no plugin with that id is installed")
	errPluginBuiltIn      = errors.New("plugins that ship with Mill cannot be removed")
)

// WirePluginRemoval hands the service its mutation owner. Removal
// reports errRemovalUnavailable until it is called. This is a package
// function so the runtime cannot expose composition-root wiring as RPC.
func WirePluginRemoval(s *SettingsService, mutate PluginMutation) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pluginMutation = mutate
}

func (s *SettingsService) withPluginMutation(id string, action func(string, bool, bool) error) error {
	s.mu.Lock()
	mutate := s.pluginMutation
	s.mu.Unlock()
	if mutate == nil {
		return errRemovalUnavailable
	}
	return mutate(id, action)
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
	dest := ""
	approvalWithdrawn := false
	err := s.withPluginMutation(id, func(dir string, builtin, found bool) error {
		if !found {
			return fmt.Errorf("%w: %q", errPluginNotInstalled, id)
		}
		if builtin {
			return fmt.Errorf("%w: %q", errPluginBuiltIn, id)
		}
		if err := s.setPluginApprovalWithoutNotification(id, false, PluginGrantSnapshot{}); err != nil {
			return err
		}
		approvalWithdrawn = true
		trash := s.pluginTrash
		if trash == nil {
			trash = filetrash.Trash
		}
		var err error
		dest, err = trash(dir)
		if err != nil {
			return usererror.Wrap("plugin-remove-trash-failed", "Extension approval was removed, but Mill could not move its folder to the Trash. Try removing it again.", err)
		}
		return nil
	})
	if approvalWithdrawn {
		dataevent.Emit("extension", id)
		s.notifyPluginPolicyChanged()
	}
	if err != nil {
		return dest, err
	}
	return dest, nil
}
