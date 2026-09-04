package settingssvc

import (
	"encoding/json"
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

// readIDList decodes one JSON-array-of-ids setting; recorded reports
// whether the key has ever been written (an empty array IS recorded).
func (s *SettingsService) readIDList(key string) (ids []string, recorded bool) {
	raw, ok := s.store.Get(key).(string)
	if !ok || strings.TrimSpace(raw) == "" {
		return []string{}, false
	}
	if err := json.Unmarshal([]byte(raw), &ids); err != nil || ids == nil {
		return []string{}, true
	}
	return ids, true
}

func (s *SettingsService) writeIDList(key string, ids []string) error {
	if ids == nil {
		ids = []string{}
	}
	data, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	return s.store.Set(key, string(data))
}

// GetAllowedPlugins returns every plugin id the user allowed to run.
// Never nil.
func (s *SettingsService) GetAllowedPlugins() []string {
	ids, _ := s.readIDList(allowedPluginsKey)
	return ids
}

// SetPluginAllowed records (or withdraws) the user's consent for id to
// run, and emits the extension dataevent so the Extensions page
// refreshes. Withdrawing consent does not stop an already-activated
// plugin -- like disabling, it changes what loads at the next boot.
func (s *SettingsService) SetPluginAllowed(id string, allowed bool) error {
	current := s.GetAllowedPlugins()
	next := make([]string, 0, len(current)+1)
	for _, existing := range current {
		if existing != id {
			next = append(next, existing)
		}
	}
	if allowed {
		next = append(next, id)
	}
	if err := s.writeIDList(allowedPluginsKey, next); err != nil {
		return err
	}
	// The lock records the hash the consent covers; withdrawing consent
	// forgets it (settingsservice_pluginlock.go).
	if allowed {
		if err := s.recordPluginLock(id); err != nil {
			return err
		}
	} else if err := s.forgetPluginLock(id); err != nil {
		return err
	}
	dataevent.Emit("extension", id)
	s.notifyPluginPolicyChanged()
	return nil
}

// RecordAllowedPluginsIfUnset writes ids as the allowed set ONLY when
// the setting has never been recorded -- the one-shot grandfathering
// of plugins present before the run gate existed. Reports whether it
// wrote.
//
//wails:ignore
func (s *SettingsService) RecordAllowedPluginsIfUnset(ids []string) (bool, error) {
	if _, recorded := s.readIDList(allowedPluginsKey); recorded {
		return false, nil
	}
	if err := s.writeIDList(allowedPluginsKey, ids); err != nil {
		return true, err
	}
	return true, s.recordPluginLock(ids...)
}

// GetPluginAllowlist returns the administrator's allow-list, empty
// when no policy is set. Never nil. Read-only from the UI by design.
func (s *SettingsService) GetPluginAllowlist() []string {
	ids, _ := s.readIDList(pluginAllowlistKey)
	return ids
}

// GetPluginSigningKeys returns the pinned minisign public keys, empty
// when no signing policy is set. Never nil. Read-only from the UI.
func (s *SettingsService) GetPluginSigningKeys() []string {
	ids, _ := s.readIDList(pluginSigningKeysKey)
	return ids
}
