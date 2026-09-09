package settingssvc

import (
	"encoding/json"
)

// The plugin lock (ADR-0051 §4, slice 5, widened by docs/goals/0375
// S2): the content hash AND the capability-shaped grant recorded at
// the moment the user allowed each plugin, keyed by id, in Mill's own
// settings (never inside the plugins folder, which a plugin could
// rewrite). The hash names "files changed since you allowed it"; the
// grant fields are the baseline widen detection compares a later
// manifest against, since no prior manifest is kept on disk -- the
// grant record IS the baseline.
const pluginLockKey = "settings-plugin-lock"

// PluginLockEntry is one recorded trust moment: the version and
// content hash the consent covered, plus the capability-shaped set the
// manifest declared at that moment.
type PluginLockEntry struct {
	Version      string   `json:"version"`
	Hash         string   `json:"hash"`
	Capabilities []string `json:"capabilities,omitempty"`
	Hosts        []string `json:"hosts,omitempty"`
	AnyHost      bool     `json:"anyHost,omitempty"`
	Kinds        []string `json:"kinds,omitempty"`
	UsesSecrets  bool     `json:"usesSecrets,omitempty"`
	CanvasHost   bool     `json:"canvasHost,omitempty"`
}

// PluginGrantSnapshot is what SetPluginHasher's function answers about
// one plugin at the moment consent is recorded (docs/goals/0375 S2):
// its version and content hash (ADR-0051 §4 slice 5), plus the shape
// of what it currently declares.
type PluginGrantSnapshot struct {
	Version      string
	Hash         string
	Capabilities []string
	Hosts        []string
	AnyHost      bool
	Kinds        []string
	UsesSecrets  bool
	CanvasHost   bool
}

// PluginHasher answers a plugin's current grant snapshot (a zero-value
// Hash for a built-in or an unreadable folder); the plugin service,
// wired by the composition root.
type PluginHasher func(id string) PluginGrantSnapshot

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

// recordPluginLock stores the plugin's current grant snapshot (or
// clears the entry when the hasher knows nothing about it).
func (s *SettingsService) recordPluginLock(ids ...string) error {
	if s.pluginHasher == nil {
		return nil
	}
	lock := s.GetPluginLock()
	for _, id := range ids {
		snap := s.pluginHasher(id)
		if snap.Hash == "" {
			delete(lock, id)
			continue
		}
		// PluginGrantSnapshot and PluginLockEntry share the same field
		// sequence (only the json tags differ) -- a straight conversion
		// over a field-by-field copy.
		lock[id] = PluginLockEntry(snap)
	}
	return s.writePluginLock(lock)
}

// RecordPluginLockNow re-baselines id's WHOLE recorded entry -- hash
// and capability-shaped grant alike -- onto the hasher's CURRENT
// snapshot (docs/goals/0420's pre-#806 lock migration): a format
// predating the capability-shaped grant fields (docs/goals/0375 S2)
// carries no Capabilities/Hosts/Kinds baseline at all, which reads as
// "granted nothing" and widens on the plugin's very next declared
// capability -- a hash-only fix is not enough. Re-recording the whole
// entry from what the plugin currently declares is exactly the
// migration's own "the files are byte-identical, so nothing changed"
// premise applied to the grant shape too. A no-op when nothing is
// recorded for id, or no hasher is installed.
//
//wails:ignore
func (s *SettingsService) RecordPluginLockNow(id string) error {
	if _, ok := s.GetPluginLock()[id]; !ok {
		return nil
	}
	return s.recordPluginLock(id)
}

func (s *SettingsService) forgetPluginLock(id string) error {
	lock := s.GetPluginLock()
	if _, ok := lock[id]; !ok {
		return nil
	}
	delete(lock, id)
	return s.writePluginLock(lock)
}

// PluginGrant returns the recorded grant for id, and whether one is
// recorded at all (docs/goals/0375 S2) -- false for a plugin never
// allowed, so widen detection then has nothing to compare. The
// frontend never calls this directly: PluginInfo.Widened already
// carries the diff a scan needs.
//
//wails:ignore
func (s *SettingsService) PluginGrant(id string) (PluginLockEntry, bool) {
	entry, ok := s.GetPluginLock()[id]
	return entry, ok
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
