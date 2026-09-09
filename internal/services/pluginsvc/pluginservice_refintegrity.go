package pluginsvc

import (
	"encoding/json"

	"github.com/alicoding/mill/internal/domain/reference"
)

// The entityRef setting's reference-integrity half (docs/goals/0400):
// pluginsvc owns which settings are declared entityRef and their
// entityKind (the manifest); readSetting (wired the same seam
// secretForFetch already uses, WireSecretRefs) answers each one's
// current stored value. No persisted index -- both queries below scan
// live state on demand, the same posture compositionsvc.WorkflowsReferencing
// already takes for workflow nodes: a setting cleared or a plugin
// removed simply stops appearing on the NEXT call, nothing to keep in
// sync.

// PluginsReferencing returns one reference.PluginRef per installed
// plugin whose currently-stored entityRef setting of entityKind holds
// id -- configuresvc's combined reference index (References,
// configureservice_refintegrity.go) calls this through
// WirePluginReferenceLookup, the same nil-safe-until-wired seam
// boardRefs already follows.
//
//wails:ignore
func (p *PluginService) PluginsReferencing(entityKind, id string) []reference.PluginRef {
	if id == "" || p.readSetting == nil {
		return nil
	}
	plugins, err := p.ListPlugins()
	if err != nil {
		return nil
	}
	var refs []reference.PluginRef
	for _, pl := range plugins {
		for _, st := range pl.Manifest.Contributes.EffectiveSettings() {
			if ref, ok := p.pluginRefIfMatching(pl, st, entityKind, id); ok {
				refs = append(refs, ref)
			}
		}
	}
	return refs
}

// pluginRefIfMatching is PluginsReferencing's own per-setting check,
// split out to keep that scan's cognitive complexity low: ok is false
// for anything but an entityRef setting of entityKind currently
// holding id.
func (p *PluginService) pluginRefIfMatching(pl PluginInfo, st SettingContribution, entityKind, id string) (reference.PluginRef, bool) {
	if st.Type != SettingTypeEntityRef || st.EntityKind != entityKind {
		return reference.PluginRef{}, false
	}
	literal, ok := p.readSetting(pl.Manifest.ID, st.Key)
	if !ok {
		return reference.PluginRef{}, false
	}
	var value string
	_ = json.Unmarshal([]byte(literal), &value)
	if value != id {
		return reference.PluginRef{}, false
	}
	label := pl.Manifest.Name
	if label == "" {
		label = pl.Manifest.ID
	}
	return reference.PluginRef{PluginID: pl.Manifest.ID, SettingKey: st.Key, Label: label}, true
}

// EntityRefEntityKind resolves whether pluginID's manifest declares
// key as an entityRef setting, and if so, which entityKind -- called
// from settingssvc's own write path (SetExtensionSetting) to know
// whether a changed value should fire the entity.referenced/
// entity.dereferenced lifecycle events (docs/goals/0392 S2, extended
// by docs/goals/0400 to this third reference source).
//
//wails:ignore
func (p *PluginService) EntityRefEntityKind(pluginID, key string) (string, bool) {
	info := p.resolvePlugin(pluginID)
	if info.Manifest.ID == "" {
		return "", false
	}
	for _, st := range info.Manifest.Contributes.EffectiveSettings() {
		if st.Key == key && st.Type == SettingTypeEntityRef {
			return st.EntityKind, true
		}
	}
	return "", false
}
