package settingssvc

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
)

// pluginStorageKey persists every runtime plugin's own key-value
// storage as ONE JSON blob keyed plugin id -> key -> value (docs/goals/
// 0277, the converged extension-storage door: VS Code globalState,
// Obsidian saveData, Chrome storage.local). Same atomic-blob shape as
// extensionSettingsKey, one tier apart: a plugin's storage is private
// state the plugin alone reads, so no dataevent is emitted for it and
// nothing in Mill's own UI renders it. Values are ANY JSON value
// (objects and arrays included -- unlike a declared setting's scalar
// floor), carried across the Wails boundary as literals in strings.
const pluginStorageKey = "settings-plugin-storage"

// pluginStorageKeyPattern keeps keys to a shape safe as a JSON object
// member and legible in the blob; a dot is allowed (a plugin may
// namespace) since the blob is one level deep by construction.
var pluginStorageKeyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`)

var errBadPluginStorageKey = errors.New("a plugin storage key must be 1-128 letters, digits, or _ . : -")
var errNotJSONValue = errors.New("a plugin storage value must be valid JSON")

func (s *SettingsService) readPluginStorage() map[string]map[string]json.RawMessage {
	raw, ok := s.store.Get(pluginStorageKey).(string)
	if !ok || raw == "" {
		return map[string]map[string]json.RawMessage{}
	}
	var out map[string]map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &out); err != nil || out == nil {
		return map[string]map[string]json.RawMessage{}
	}
	return out
}

func (s *SettingsService) writePluginStorage(all map[string]map[string]json.RawMessage) error {
	encoded, err := json.Marshal(all)
	if err != nil {
		return err
	}
	return s.store.Set(pluginStorageKey, string(encoded))
}

// GetPluginStorage returns every plugin's stored values as JSON
// literals. Never nil.
func (s *SettingsService) GetPluginStorage() map[string]map[string]string {
	out := map[string]map[string]string{}
	for plugin, keys := range s.readPluginStorage() {
		out[plugin] = map[string]string{}
		for k, v := range keys {
			out[plugin][k] = string(v)
		}
	}
	return out
}

// SetPluginStorageValue stores one plugin's one value (any valid JSON,
// given as its literal) and persists the blob. A JSON null is refused
// -- deleting is DeletePluginStorageValue's job, so a stored null can
// never masquerade as "absent".
func (s *SettingsService) SetPluginStorageValue(pluginID, key, jsonValue string) error {
	if !pluginStorageKeyPattern.MatchString(key) {
		return fmt.Errorf("%w: %q", errBadPluginStorageKey, key)
	}
	if !json.Valid([]byte(jsonValue)) || jsonValue == "null" {
		return fmt.Errorf("%w (got %q)", errNotJSONValue, jsonValue)
	}
	compact, err := compactJSON(jsonValue)
	if err != nil {
		return err
	}
	all := s.readPluginStorage()
	if all[pluginID] == nil {
		all[pluginID] = map[string]json.RawMessage{}
	}
	all[pluginID][key] = compact
	return s.writePluginStorage(all)
}

// DeletePluginStorageValue removes one key; deleting an absent key is
// a no-op success (the converged storage semantic).
func (s *SettingsService) DeletePluginStorageValue(pluginID, key string) error {
	all := s.readPluginStorage()
	if all[pluginID] == nil {
		return nil
	}
	delete(all[pluginID], key)
	if len(all[pluginID]) == 0 {
		delete(all, pluginID)
	}
	return s.writePluginStorage(all)
}

func compactJSON(literal string) (json.RawMessage, error) {
	var v any
	if err := json.Unmarshal([]byte(literal), &v); err != nil {
		return nil, fmt.Errorf("%w: %v", errNotJSONValue, err)
	}
	return json.Marshal(v)
}
