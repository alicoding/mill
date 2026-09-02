package settingssvc

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/alicoding/mill/internal/services/dataevent"
)

// extensionSettingsKey persists every extension's own declared-setting
// values as ONE JSON blob keyed extension id -> setting key -> value —
// the same "atomic blob, not one key per id" shape
// disabledExtensionsKey (settingsservice_extensions.go) already
// establishes. A key absent from the blob means the extension's own
// declared default applies; the store never learns the defaults
// (they live on the frontend declaration, goal 0258), so clearing a
// value back to its default is just writing the default's value.
//
// Values are typed JSON scalars (bool, string, number — the four-type
// declaration floor, enum being a string) held as json.RawMessage so
// the blob written by the booleans-only first slice reads back
// unchanged. Across the Wails boundary each value travels as its JSON
// literal in a string: no bound method in this codebase takes an
// `any`, and a literal keeps the contract explicit at both ends.
const extensionSettingsKey = "settings-extension-settings"

// errNotScalarSetting is the fail-closed answer to a value that is not
// a JSON scalar (an object, an array, null, or not JSON at all).
var errNotScalarSetting = errors.New("an extension setting value must be a JSON boolean, string, or number")

func (s *SettingsService) readExtensionSettings() map[string]map[string]json.RawMessage {
	raw, ok := s.store.Get(extensionSettingsKey).(string)
	if !ok || raw == "" {
		return map[string]map[string]json.RawMessage{}
	}
	var settings map[string]map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &settings); err != nil || settings == nil {
		return map[string]map[string]json.RawMessage{}
	}
	return settings
}

// GetExtensionSettings returns every stored per-extension setting
// value as its JSON literal ("true", "\"hostname\"", "25"). Never nil
// — always at least an empty map, so a caller can json-encode it
// straight to the frontend without a nil check.
func (s *SettingsService) GetExtensionSettings() map[string]map[string]string {
	out := map[string]map[string]string{}
	for ext, keys := range s.readExtensionSettings() {
		out[ext] = map[string]string{}
		for k, v := range keys {
			out[ext][k] = string(v)
		}
	}
	return out
}

// SetExtensionSetting stores one extension's one declared-setting
// value (given as its JSON literal), persists the updated blob, and
// emits dataevent so every open consumer (the Extensions section, a
// canvas surface reading the setting, a plugin's onChange) refreshes
// live rather than only after a reload. Anything but a JSON scalar is
// refused before the blob is touched.
func (s *SettingsService) SetExtensionSetting(extensionID, key, jsonValue string) error {
	compact, err := validateScalarSetting(jsonValue)
	if err != nil {
		return err
	}
	settings := s.readExtensionSettings()
	if settings[extensionID] == nil {
		settings[extensionID] = map[string]json.RawMessage{}
	}
	settings[extensionID][key] = compact
	encoded, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	if err := s.store.Set(extensionSettingsKey, string(encoded)); err != nil {
		return err
	}
	dataevent.Emit("extension-setting", extensionID)
	return nil
}

// validateScalarSetting accepts exactly a JSON boolean, string, or
// number and returns it re-encoded (whitespace-free, so the blob
// stays canonical whatever the caller's formatting).
func validateScalarSetting(jsonValue string) (json.RawMessage, error) {
	var v any
	if err := json.Unmarshal([]byte(jsonValue), &v); err != nil {
		return nil, fmt.Errorf("%w: %v", errNotScalarSetting, err)
	}
	switch v.(type) {
	case bool, string, float64:
		return json.Marshal(v)
	default:
		return nil, errNotScalarSetting
	}
}
