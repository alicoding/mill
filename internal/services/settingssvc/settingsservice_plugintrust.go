package settingssvc

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/services/dataevent"
)

// The plugin trust posture (ADR-0051 §4, slice 3), two lists:
//
//   - allowedPluginsKey: plugin ids the user has allowed to RUN after
//     reading the install-time reach summary (the converged browser-
//     extension install prompt: nothing runs before consent). Absent
//     entirely on an instance that predates the gate; the composition
//     root records every plugin already present the first time it
//     boots with the gate (RecordAllowedPluginsIfUnset), so an upgrade
//     never turns a working plugin off -- only plugins installed AFTER
//     that wait for review.
//   - pluginAllowlistKey: an administrator's allow-list of plugin ids.
//     Non-empty means ONLY those ids may run at all (the device-
//     management shape: the key is written into the settings file by
//     policy tooling, never through Mill's UI, which only reports it).
//     Empty means no policy. Built-in plugins are exempt from both.
const (
	allowedPluginsKey  = "settings-allowed-plugins"
	pluginAllowlistKey = "settings-plugin-allowlist"
	// pluginSigningKeysKey: minisign public keys an administrator pinned
	// (the opt-in signed tier); written by policy tooling like the
	// allow-list, reported read-only.
	pluginSigningKeysKey = "settings-plugin-signing-keys"
)

// readIDList decodes one JSON-array-of-ids setting.
func (s *SettingsService) readIDList(key string) []string {
	var ids []string
	raw, ok := s.store.Get(key).(string)
	if !ok || strings.TrimSpace(raw) == "" {
		return []string{}
	}
	if err := json.Unmarshal([]byte(raw), &ids); err != nil || ids == nil {
		return []string{}
	}
	return ids
}

// GetAllowedPlugins returns every plugin id the user allowed to run.
// Never nil.
func (s *SettingsService) GetAllowedPlugins() ([]string, error) {
	snapshot, err := ReadPluginApprovalSnapshot(s)
	if err != nil {
		return nil, err
	}
	return snapshot.Allowed, nil
}

// SetPluginAllowed records (or withdraws) the user's consent for id to
// run, and emits the extension dataevent so the Extensions page
// refreshes. Withdrawing consent does not stop an already-activated
// plugin -- like disabling, it changes what loads at the next boot.
func (s *SettingsService) SetPluginAllowed(id string, allowed bool) error {
	if !approvalPluginIDPattern.MatchString(id) {
		return fmt.Errorf("invalid extension id %q", id)
	}
	if err := s.withPluginMutation(id, func(_ string, builtin, found bool) error {
		var captured PluginGrantSnapshot
		if allowed {
			if !found || builtin {
				return fmt.Errorf("extension %q is not an installed external extension", id)
			}
			if s.pluginHasher == nil {
				return errPluginApprovalUnavailable
			}
			var err error
			captured, err = s.pluginHasher(id)
			if err != nil {
				return err
			}
			if captured.Hash == "" {
				return fmt.Errorf("extension %q package identity is unavailable", id)
			}
		}
		return s.setPluginApprovalWithoutNotification(id, allowed, captured)
	}); err != nil {
		return err
	}
	dataevent.Emit("extension", id)
	s.notifyPluginPolicyChanged()
	return nil
}

// setPluginApprovalWithoutNotification commits one consent transition while
// the caller owns package mutation. It deliberately does not publish live
// events: callers do that only after releasing the package and settings locks.
func (s *SettingsService) setPluginApprovalWithoutNotification(id string, allowed bool, captured PluginGrantSnapshot) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.updatePluginApprovalLocked(func(state *pluginApprovalState) error {
		next := make([]string, 0, len(state.Allowed)+1)
		for _, existing := range state.Allowed {
			if existing != id {
				next = append(next, existing)
			}
		}
		if allowed {
			next = append(next, id)
			state.Locks[id] = lockEntryFromSnapshot(captured)
		} else {
			delete(state.Locks, id)
		}
		state.LegacyUnpinned = removePluginID(state.LegacyUnpinned, id)
		state.Allowed = next
		state.Initialized = true
		return nil
	})
	return err
}

// RecordAllowedPluginsIfUnset writes ids as the allowed set ONLY when
// the setting has never been recorded -- the one-shot grandfathering
// of plugins present before the run gate existed. Reports whether it
// wrote.
//
//wails:ignore
func (s *SettingsService) RecordAllowedPluginsIfUnset(ids []string) (bool, error) {
	snapshot, err := ReadPluginApprovalSnapshot(s)
	if err != nil || snapshot.Initialized {
		return false, err
	}
	grants := make(map[string]PluginGrantSnapshot, len(ids))
	for _, id := range ids {
		if !approvalPluginIDPattern.MatchString(id) {
			return false, fmt.Errorf("invalid extension id %q", id)
		}
		if err := s.withPluginMutation(id, func(_ string, builtin, found bool) error {
			if !found || builtin || s.pluginHasher == nil {
				return fmt.Errorf("extension %q package identity is unavailable", id)
			}
			grant, err := s.pluginHasher(id)
			if err != nil {
				return err
			}
			if grant.Hash == "" {
				return fmt.Errorf("extension %q package identity is unavailable", id)
			}
			grants[id] = grant
			return nil
		}); err != nil {
			return false, err
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	wrote := false
	err = s.updatePluginApprovalLocked(func(state *pluginApprovalState) error {
		if state.Initialized {
			return nil
		}
		state.Initialized = true
		state.Allowed = append([]string(nil), ids...)
		state.LegacyUnpinned = []string{}
		for id, grant := range grants {
			state.Locks[id] = lockEntryFromSnapshot(grant)
		}
		wrote = true
		return nil
	})
	return wrote, err
}

// GetPluginAllowlist returns the administrator's allow-list, empty
// when no policy is set. Never nil. Read-only from the UI by design.
func (s *SettingsService) GetPluginAllowlist() []string {
	return s.readIDList(pluginAllowlistKey)
}

// GetPluginSigningKeys returns the pinned minisign public keys, empty
// when no signing policy is set. Never nil. Read-only from the UI.
func (s *SettingsService) GetPluginSigningKeys() []string {
	return s.readIDList(pluginSigningKeysKey)
}
