package settingssvc

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"

	"github.com/alicoding/mill/internal/domain/usererror"
)

const pluginApprovalStateVersion = 1

var approvalPluginIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

type pluginApprovalState struct {
	Version        int                        `json:"version"`
	Initialized    bool                       `json:"initialized"`
	Allowed        []string                   `json:"allowed"`
	Locks          map[string]PluginLockEntry `json:"locks"`
	LegacyUnpinned []string                   `json:"legacyUnpinned"`
}

// PluginApprovalSnapshot is one detached approval revision used by a decision.
type PluginApprovalSnapshot struct {
	Revision       int64
	Initialized    bool
	Allowed        []string
	Locks          map[string]PluginLockEntry
	LegacyUnpinned []string
}

type PluginApprovalRead func() (payload []byte, revision int64, present bool, err error)
type PluginApprovalInitializer func() ([]byte, error)
type PluginApprovalChange func(current []byte) ([]byte, error)
type PluginApprovalUpdate func(approvalInitializer PluginApprovalInitializer, change PluginApprovalChange) ([]byte, int64, error)

var errPluginApprovalUnavailable = errors.New("extension approval state is unavailable")

// SetPluginApprovalStore installs the authoritative transactional approval port.
func SetPluginApprovalStore(s *SettingsService, read PluginApprovalRead, update PluginApprovalUpdate) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.approvalRead = read
	s.approvalUpdate = update
}

// ReadPluginApprovalSnapshot returns allowed membership and locks from one revision.
func ReadPluginApprovalSnapshot(s *SettingsService) (PluginApprovalSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readPluginApprovalSnapshotLocked()
}

func (s *SettingsService) readPluginApprovalSnapshotLocked() (PluginApprovalSnapshot, error) {
	if s.approvalRead == nil || s.approvalUpdate == nil {
		return PluginApprovalSnapshot{}, usererror.Wrap("plugin-approval-unavailable", "Extension approval state is unavailable.", errPluginApprovalUnavailable)
	}
	payload, revision, present, err := s.approvalRead()
	if err != nil {
		return PluginApprovalSnapshot{}, usererror.Wrap("plugin-approval-unavailable", "Extension approval state is unavailable.", err)
	}
	if !present {
		payload, revision, err = s.approvalUpdate(s.legacyPluginApprovalInitializerLocked, func(current []byte) ([]byte, error) {
			state, err := decodePluginApprovalState(current)
			if err != nil {
				return nil, err
			}
			return encodePluginApprovalState(state)
		})
		if err != nil {
			return PluginApprovalSnapshot{}, usererror.Wrap("plugin-approval-unavailable", "Extension approval state is unavailable.", err)
		}
	}
	state, err := decodePluginApprovalState(payload)
	if err != nil {
		return PluginApprovalSnapshot{}, usererror.Wrap("plugin-approval-corrupt", "Extension approval state is unreadable.", err)
	}
	return snapshotFromApprovalState(state, revision), nil
}

func (s *SettingsService) updatePluginApprovalLocked(change func(*pluginApprovalState) error) error {
	if s.approvalUpdate == nil {
		return usererror.Wrap("plugin-approval-unavailable", "Extension approval state is unavailable.", errPluginApprovalUnavailable)
	}
	var corrupt error
	_, _, err := s.approvalUpdate(s.legacyPluginApprovalInitializerLocked, func(current []byte) ([]byte, error) {
		state, err := decodePluginApprovalState(current)
		if err != nil {
			corrupt = err
			return nil, err
		}
		if err := change(&state); err != nil {
			return nil, err
		}
		return encodePluginApprovalState(state)
	})
	if err != nil {
		if corrupt != nil {
			return usererror.Wrap("plugin-approval-corrupt", "Extension approval state is unreadable.", corrupt)
		}
		return usererror.Wrap("plugin-approval-save-failed", "Mill could not save extension approval.", err)
	}
	return nil
}

func (s *SettingsService) legacyPluginApprovalInitializerLocked() ([]byte, error) {
	snapshotter, ok := s.store.(interface{ Snapshot() ([]byte, error) })
	if !ok {
		return nil, errors.New("settings store cannot provide a persisted snapshot")
	}
	raw, err := snapshotter.Snapshot()
	if err != nil {
		return nil, err
	}
	var values map[string]json.RawMessage
	if err := json.Unmarshal(raw, &values); err != nil || values == nil {
		return nil, errors.New("persisted settings are not a JSON object")
	}
	state := pluginApprovalState{Version: pluginApprovalStateVersion, Allowed: []string{}, Locks: map[string]PluginLockEntry{}, LegacyUnpinned: []string{}}
	if value, found := values[allowedPluginsKey]; found {
		state.Allowed, err = decodeLegacyAllowed(value)
		if err != nil {
			return nil, err
		}
		state.Initialized = true
	}
	if value, found := values[pluginLockKey]; found {
		state.Locks, err = decodeLegacyLocks(value)
		if err != nil {
			return nil, err
		}
	}
	if state.Initialized {
		state.LegacyUnpinned = missingApprovalLocks(state.Allowed, state.Locks)
	}
	return encodePluginApprovalState(state)
}

func decodeLegacyAllowed(value json.RawMessage) ([]string, error) {
	var (
		encoded string
		allowed []string
	)
	if json.Unmarshal(value, &encoded) != nil || encoded == "" || json.Unmarshal([]byte(encoded), &allowed) != nil || allowed == nil {
		return nil, errors.New("persisted extension approval list is unreadable")
	}
	return allowed, nil
}

func decodeLegacyLocks(value json.RawMessage) (map[string]PluginLockEntry, error) {
	var (
		encoded string
		locks   map[string]PluginLockEntry
	)
	if json.Unmarshal(value, &encoded) != nil || encoded == "" || json.Unmarshal([]byte(encoded), &locks) != nil || locks == nil {
		return nil, errors.New("persisted extension approval locks are unreadable")
	}
	return locks, nil
}

func missingApprovalLocks(allowed []string, locks map[string]PluginLockEntry) []string {
	missing := []string{}
	for _, id := range allowed {
		if _, locked := locks[id]; !locked {
			missing = append(missing, id)
		}
	}
	return missing
}

func decodePluginApprovalState(payload []byte) (pluginApprovalState, error) {
	var state pluginApprovalState
	if len(payload) == 0 || decodeStrictJSON(payload, &state) != nil {
		return pluginApprovalState{}, errors.New("extension approval payload is not valid JSON")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(payload, &fields) != nil || len(fields) != 5 || fields["version"] == nil || fields["initialized"] == nil || fields["allowed"] == nil || fields["locks"] == nil || fields["legacyUnpinned"] == nil {
		return pluginApprovalState{}, errors.New("extension approval payload is incomplete")
	}
	if state.Version != pluginApprovalStateVersion {
		return pluginApprovalState{}, fmt.Errorf("extension approval payload version %d is not supported", state.Version)
	}
	if state.Allowed == nil || state.Locks == nil || state.LegacyUnpinned == nil {
		return pluginApprovalState{}, errors.New("extension approval payload is incomplete")
	}
	allowed, err := validateApprovalIDs(state.Allowed)
	if err != nil {
		return pluginApprovalState{}, err
	}
	if err := validateApprovalLocks(state.Locks); err != nil {
		return pluginApprovalState{}, err
	}
	if err := validateLegacyUnpinned(state, allowed); err != nil {
		return pluginApprovalState{}, err
	}
	return state, nil
}

func validateApprovalIDs(ids []string) (map[string]bool, error) {
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if !approvalPluginIDPattern.MatchString(id) || seen[id] {
			return nil, fmt.Errorf("extension approval payload has invalid or duplicate id %q", id)
		}
		seen[id] = true
	}
	return seen, nil
}

func validateApprovalLocks(locks map[string]PluginLockEntry) error {
	for id, entry := range locks {
		if !approvalPluginIDPattern.MatchString(id) {
			return fmt.Errorf("extension approval payload has invalid lock id %q", id)
		}
		if err := validatePluginLockEntry(entry); err != nil {
			return fmt.Errorf("extension approval payload has invalid lock for %q: %w", id, err)
		}
	}
	return nil
}

func validateLegacyUnpinned(state pluginApprovalState, allowed map[string]bool) error {
	seen := make(map[string]bool, len(state.LegacyUnpinned))
	for _, id := range state.LegacyUnpinned {
		if !approvalPluginIDPattern.MatchString(id) || seen[id] || !allowed[id] {
			return fmt.Errorf("extension approval payload has invalid legacy unpinned id %q", id)
		}
		if _, locked := state.Locks[id]; locked || !state.Initialized {
			return fmt.Errorf("extension approval payload has invalid legacy unpinned id %q", id)
		}
		seen[id] = true
	}
	return nil
}

func decodeStrictJSON(payload []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return errors.New("JSON value has trailing data")
	}
	return nil
}

func encodePluginApprovalState(state pluginApprovalState) ([]byte, error) {
	state.Version = pluginApprovalStateVersion
	if state.Allowed == nil {
		state.Allowed = []string{}
	}
	if state.Locks == nil {
		state.Locks = map[string]PluginLockEntry{}
	}
	if state.LegacyUnpinned == nil {
		state.LegacyUnpinned = []string{}
	}
	if _, err := decodePluginApprovalState(mustMarshalApproval(state)); err != nil {
		return nil, err
	}
	return json.Marshal(state)
}

func mustMarshalApproval(state pluginApprovalState) []byte {
	payload, _ := json.Marshal(state)
	return payload
}

func snapshotFromApprovalState(state pluginApprovalState, revision int64) PluginApprovalSnapshot {
	locks := make(map[string]PluginLockEntry, len(state.Locks))
	for id, entry := range state.Locks {
		locks[id] = clonePluginLockEntry(entry)
	}
	return PluginApprovalSnapshot{
		Revision: revision, Initialized: state.Initialized, Allowed: append([]string{}, state.Allowed...), Locks: locks,
		LegacyUnpinned: append([]string{}, state.LegacyUnpinned...),
	}
}

func containsPluginID(ids []string, id string) bool {
	for _, candidate := range ids {
		if candidate == id {
			return true
		}
	}
	return false
}

func removePluginID(ids []string, id string) []string {
	out := ids[:0]
	for _, candidate := range ids {
		if candidate != id {
			out = append(out, candidate)
		}
	}
	return out
}
