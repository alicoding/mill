package settingssvc

import (
	"encoding/json"

	"github.com/alicoding/mill/internal/services/dataevent"
)

// extensionSettingsKey persists every extension's own declared-setting
// values as ONE JSON blob keyed extension id -> setting key -> value —
// the same "atomic blob, not one key per id" shape
// disabledExtensionsKey (settingsservice_extensions.go) already
// establishes. A key absent from the blob means the extension's own
// declared default applies; the store never learns the defaults
// (they live on the frontend declaration, goal 0258), so clearing a
// value back to its default is just writing the default's boolean.
const extensionSettingsKey = "settings-extension-settings"

// GetExtensionSettings returns every stored per-extension setting
// value. Never nil — always at least an empty map, so a caller can
// json-encode it straight to the frontend without a nil check.
func (s *SettingsService) GetExtensionSettings() map[string]map[string]bool {
	raw, ok := s.store.Get(extensionSettingsKey).(string)
	if !ok || raw == "" {
		return map[string]map[string]bool{}
	}
	var settings map[string]map[string]bool
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return map[string]map[string]bool{}
	}
	return settings
}

// SetExtensionSetting stores one extension's one declared-setting
// value, persists the updated blob, and emits dataevent so every open
// consumer (the Extensions section, a canvas surface reading the
// setting) refreshes live rather than only after a reload.
func (s *SettingsService) SetExtensionSetting(extensionID, key string, value bool) error {
	settings := s.GetExtensionSettings()
	if settings[extensionID] == nil {
		settings[extensionID] = map[string]bool{}
	}
	settings[extensionID][key] = value
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
