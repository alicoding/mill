package settingssvc

import (
	"errors"
	"sort"
	"strings"
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
	Version             string              `json:"version"`
	Hash                string              `json:"hash"`
	Capabilities        []string            `json:"capabilities,omitempty"`
	Hosts               []string            `json:"hosts,omitempty"`
	AnyHost             bool                `json:"anyHost,omitempty"`
	NetworkGrantVersion int                 `json:"networkGrantVersion,omitempty"`
	NetworkMethods      map[string][]string `json:"networkMethods,omitempty"`
	Kinds               []string            `json:"kinds,omitempty"`
	UsesSecrets         bool                `json:"usesSecrets,omitempty"`
	CanvasHost          bool                `json:"canvasHost,omitempty"`
}

// PluginGrantSnapshot is what SetPluginHasher's function answers about
// one plugin at the moment consent is recorded (docs/goals/0375 S2):
// its version and content hash (ADR-0051 §4 slice 5), plus the shape
// of what it currently declares.
type PluginGrantSnapshot struct {
	Version             string
	Hash                string
	Capabilities        []string
	Hosts               []string
	AnyHost             bool
	NetworkGrantVersion int
	NetworkMethods      map[string][]string
	Kinds               []string
	UsesSecrets         bool
	CanvasHost          bool
}

// PluginHasher answers a plugin's current grant snapshot (a zero-value
// Hash for a built-in or an unreadable folder); the plugin service,
// wired by the composition root.
type PluginHasher func(id string) (PluginGrantSnapshot, error)

// SetPluginHasher installs the hasher used when consent is recorded.
//
//wails:ignore
func (s *SettingsService) SetPluginHasher(fn PluginHasher) {
	s.pluginHasher = fn
}

// GetPluginLock returns every recorded entry. Never nil.
func (s *SettingsService) GetPluginLock() (map[string]PluginLockEntry, error) {
	snapshot, err := ReadPluginApprovalSnapshot(s)
	return snapshot.Locks, err
}

// recordPluginLock stores the plugin's current grant snapshot (or
// clears the entry when the hasher knows nothing about it).
func (s *SettingsService) recordPluginLock(ids ...string) error {
	if s.pluginHasher == nil {
		return errPluginApprovalUnavailable
	}
	snapshots := make(map[string]PluginGrantSnapshot, len(ids))
	for _, id := range ids {
		snapshot, err := s.pluginHasher(id)
		if err != nil {
			return err
		}
		if snapshot.Hash == "" {
			return errors.New("extension package identity is unavailable")
		}
		snapshots[id] = snapshot
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.updatePluginApprovalLocked(func(state *pluginApprovalState) error {
		for id, snapshot := range snapshots {
			state.Locks[id] = lockEntryFromSnapshot(snapshot)
			state.LegacyUnpinned = removePluginID(state.LegacyUnpinned, id)
		}
		return nil
	})
	return err
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
	locks, err := s.GetPluginLock()
	if err != nil {
		return err
	}
	if _, ok := locks[id]; !ok {
		return nil
	}
	return s.withPluginMutation(id, func(string, bool, bool) error { return s.recordPluginLock(id) })
}

func (s *SettingsService) forgetPluginLock(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.updatePluginApprovalLocked(func(state *pluginApprovalState) error {
		delete(state.Locks, id)
		state.LegacyUnpinned = removePluginID(state.LegacyUnpinned, id)
		return nil
	})
	return err
}

// PluginGrant returns the recorded grant for id, and whether one is
// recorded at all (docs/goals/0375 S2) -- false for a plugin never
// allowed, so widen detection then has nothing to compare. The
// frontend never calls this directly: PluginInfo.Widened already
// carries the diff a scan needs.
//
//wails:ignore
func (s *SettingsService) PluginGrant(id string) (PluginLockEntry, bool, error) {
	lock, err := s.GetPluginLock()
	entry, ok := lock[id]
	return entry, ok, err
}

// PluginLockMatches reports whether id's recorded hash equals current.
// A missing lock matches only the validated legacy-unpinned marker
// created while migrating an explicitly persisted historical grant.
func (s *SettingsService) PluginLockMatches(id, current string) bool {
	snapshot, err := ReadPluginApprovalSnapshot(s)
	if err != nil || current == "" {
		return false
	}
	entry, ok := snapshot.Locks[id]
	if !ok {
		return containsPluginID(snapshot.Allowed, id) && containsPluginID(snapshot.LegacyUnpinned, id)
	}
	return entry.Hash != "" && entry.Hash == current
}

func lockEntryFromSnapshot(snapshot PluginGrantSnapshot) PluginLockEntry {
	return PluginLockEntry{
		Version: snapshot.Version, Hash: snapshot.Hash,
		Capabilities: append([]string(nil), snapshot.Capabilities...), Hosts: append([]string(nil), snapshot.Hosts...), AnyHost: snapshot.AnyHost,
		NetworkGrantVersion: snapshot.NetworkGrantVersion, NetworkMethods: cloneNetworkMethods(snapshot.NetworkMethods),
		Kinds: append([]string(nil), snapshot.Kinds...), UsesSecrets: snapshot.UsesSecrets, CanvasHost: snapshot.CanvasHost,
	}
}

func clonePluginLockEntry(entry PluginLockEntry) PluginLockEntry {
	entry.Capabilities = append([]string(nil), entry.Capabilities...)
	entry.Hosts = append([]string(nil), entry.Hosts...)
	entry.Kinds = append([]string(nil), entry.Kinds...)
	entry.NetworkMethods = cloneNetworkMethods(entry.NetworkMethods)
	return entry
}

func cloneNetworkMethods(methods map[string][]string) map[string][]string {
	if methods == nil {
		return nil
	}
	out := make(map[string][]string, len(methods))
	for host, values := range methods {
		out[host] = append([]string(nil), values...)
	}
	return out
}

func validatePluginLockEntry(entry PluginLockEntry) error {
	if entry.Hash == "" {
		return errors.New("content hash is empty")
	}
	if entry.NetworkGrantVersion != 0 && entry.NetworkGrantVersion != 1 {
		return errors.New("network grant version is unsupported")
	}
	if entry.NetworkGrantVersion == 0 && len(entry.NetworkMethods) > 0 {
		return errors.New("legacy network grant carries method evidence")
	}
	for host, methods := range entry.NetworkMethods {
		if err := validateNetworkMethods(host, methods); err != nil {
			return err
		}
	}
	return nil
}

func validateNetworkMethods(host string, methods []string) error {
	if strings.TrimSpace(host) == "" || len(methods) == 0 || !sort.StringsAreSorted(methods) {
		return errors.New("network methods are not canonical")
	}
	for i, method := range methods {
		if method == "" || method != strings.ToUpper(method) || (i > 0 && methods[i-1] == method) {
			return errors.New("network methods are not canonical")
		}
	}
	return nil
}
