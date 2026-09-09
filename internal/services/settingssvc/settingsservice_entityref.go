package settingssvc

import (
	"encoding/json"

	"github.com/alicoding/mill/internal/domain/reference"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// The entityRef plugin-setting lifecycle door (docs/goals/0400,
// extending docs/goals/0392 S2's entity.referenced/dereferenced pair
// to a third reference source): SetExtensionSetting is the one write
// path every entityRef control goes through
// (settingsservice_extensionsettings.go), so this is the one place a
// changed value needs to fire the lifecycle events -- never a second
// write path plugin settings could bypass.

// WireEntityReferenceEvents connects pluginsvc's manifest lookup
// (which setting is entityRef, and its entityKind) and configuresvc's
// combined reference index (the live count after this change) --
// called once from the composition root, after all three services
// exist. Nil until wired, in which case SetExtensionSetting fires no
// lifecycle events at all (the same posture every other late-bound
// seam here takes).
//
//wails:ignore
func (s *SettingsService) WireEntityReferenceEvents(lookup func(pluginID, key string) (entityKind string, ok bool), index func(entityKind, id string) reference.Refs) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entityRefLookup = lookup
	s.referenceIndex = index
}

// emitEntityRefChange fires entity.referenced/entity.dereferenced when
// key is a declared entityRef setting whose value actually changed
// (previous and nextValue are both the plain string id the wire
// carries -- "" means unset). Both may fire in the same call (a value
// changing from one entity to another dereferences the old one and
// references the new one); a clear or a first pick fires only one
// side.
func (s *SettingsService) emitEntityRefChange(pluginID, key, previous, nextValue string) {
	s.mu.Lock()
	lookup := s.entityRefLookup
	index := s.referenceIndex
	s.mu.Unlock()
	if lookup == nil || nextValue == previous {
		return
	}
	entityKind, ok := lookup(pluginID, key)
	if !ok {
		return
	}
	by := dataevent.LifecycleBy{PluginID: pluginID, SettingKey: key}
	if nextValue != "" {
		dataevent.EmitEntityReferenced(entityKind, nextValue, by)
	}
	if previous != "" {
		remaining := 0
		if index != nil {
			remaining = index(entityKind, previous).Count()
		}
		dataevent.EmitEntityDereferenced(entityKind, previous, by, remaining)
	}
}

// decodeStringSetting reads a stored setting literal as a plain string
// ("" for anything not a JSON string -- a boolean/number/enum setting
// changing is never an entityRef change, and this is only ever called
// for a key emitEntityRefChange's own lookup already confirmed is
// entityRef).
func decodeStringSetting(literal json.RawMessage) string {
	var v string
	_ = json.Unmarshal(literal, &v)
	return v
}
