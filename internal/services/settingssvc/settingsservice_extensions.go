package settingssvc

import (
	"encoding/json"

	"github.com/alicoding/mill/internal/services/dataevent"
)

// disabledExtensionsKey persists the set of canvas-extension ids the
// user has turned off (Settings > Extensions) as one JSON array --
// same "atomic blob, not one key per id" shape
// workflowMinutesSavedKey (settingsservice_minutessaved.go) already
// establishes. An id absent from the array is enabled; this is the
// ONLY state a disabled extension carries -- no per-extension config.
const disabledExtensionsKey = "settings-disabled-extensions"

// GetDisabledExtensions returns every extension id the user has turned
// off. Never nil -- always at least an empty slice, so a caller can
// range over it (or json-encode it straight to the frontend) without a
// nil check.
func (s *SettingsService) GetDisabledExtensions() []string {
	raw, ok := s.store.Get(disabledExtensionsKey).(string)
	if !ok || raw == "" {
		return []string{}
	}
	var ids []string
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		return []string{}
	}
	return ids
}

// SetExtensionEnabled turns id on (enabled=true) or off
// (enabled=false), persists the updated set, and emits dataevent so
// every open Settings section and the live canvas both refresh --
// disabling drops the tool from the creation tray/palette immediately
// in any open Atlas view, never only after a reload. Existing board
// objects of that kind are untouched by this call and every future
// one: disabling an extension changes what CAN be created, never what
// was already created (the frontend registry lookup that renders a
// placed object never consults this list).
func (s *SettingsService) SetExtensionEnabled(id string, enabled bool) error {
	current := s.GetDisabledExtensions()
	next := make([]string, 0, len(current)+1)
	found := false
	for _, existing := range current {
		if existing == id {
			found = true
			if enabled {
				continue // drop it from the disabled set -- re-enabling
			}
		}
		next = append(next, existing)
	}
	if !enabled && !found {
		next = append(next, id)
	}
	data, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if err := s.store.Set(disabledExtensionsKey, string(data)); err != nil {
		return err
	}
	dataevent.Emit("extension", id)
	return nil
}
