package settingssvc

import (
	"encoding/json"
)

// The plugin lock (ADR-0051 §4, slice 5): the content hash recorded
// at the moment the user allowed each plugin, keyed by id, in Mill's
// own settings (never inside the plugins folder, which a plugin could
// rewrite). A plugin whose current hash differs is "changed since you
// allowed it" and does not run until allowed again.
const pluginLockKey = "settings-plugin-lock"

// PluginLockEntry is one recorded trust moment.
type PluginLockEntry struct {
	Version string `json:"version"`
	Hash    string `json:"hash"`
}

// PluginHasher answers a plugin's current version and content hash
// ("" hash for a built-in or an unreadable folder); the plugin service,
// wired by the composition root.
type PluginHasher func(id string) (version, hash string)

// SetPluginHasher installs the hasher used when consent is recorded.
//
//wails:ignore
func (s *SettingsService) SetPluginHasher(fn PluginHasher) {
	s.pluginHasher = fn
}

// GetPluginLock returns every recorded entry. Never nil.
func (s *SettingsService) GetPluginLock() map[string]PluginLockEntry {
	out := map[string]PluginLockEntry{}
	raw, ok := s.store.Get(pluginLockKey).(string)
	if !ok || raw == "" {
		return out
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil || out == nil {
		return map[string]PluginLockEntry{}
	}
	return out
}

func (s *SettingsService) writePluginLock(lock map[string]PluginLockEntry) error {
	data, err := json.Marshal(lock)
	if err != nil {
		return err
	}
	return s.store.Set(pluginLockKey, string(data))
}

// recordPluginLock stores the plugin's current version and hash (or
// clears the entry when the hasher knows nothing about it).
func (s *SettingsService) recordPluginLock(ids ...string) error {
	if s.pluginHasher == nil {
		return nil
	}
	lock := s.GetPluginLock()
	for _, id := range ids {
		version, hash := s.pluginHasher(id)
		if hash == "" {
			delete(lock, id)
			continue
		}
		lock[id] = PluginLockEntry{Version: version, Hash: hash}
	}
	return s.writePluginLock(lock)
}

func (s *SettingsService) forgetPluginLock(id string) error {
	lock := s.GetPluginLock()
	if _, ok := lock[id]; !ok {
		return nil
	}
	delete(lock, id)
	return s.writePluginLock(lock)
}

// PluginLockMatches reports whether id's recorded hash equals current
// -- true as well when nothing was ever recorded for it (an instance
// from before the lock existed, or a plugin without a readable
// folder), so the lock only ever REVOKES consent it saw granted.
func (s *SettingsService) PluginLockMatches(id, current string) bool {
	entry, ok := s.GetPluginLock()[id]
	if !ok || entry.Hash == "" || current == "" {
		return true
	}
	return entry.Hash == current
}
