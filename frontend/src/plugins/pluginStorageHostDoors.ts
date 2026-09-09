import { SettingsService } from '../shared/bindings'
import type { PluginStorageDoors } from './pluginStorage'

// settingsPluginStorageDoors is buildPluginStorage's SettingsService-
// backed door pair: the persistence a same-DOM plugin's own api.storage
// uses (hostApi.ts), and the one plugins/activation.ts decodes from
// before handing the snapshot into a framed activation's own srcdoc
// init. Kept out of pluginStorage.ts itself (goal 0396): that module is
// bundled wholesale into the plugin-frame runtime's build
// (frontend/src/plugin-frame/activation.ts), which never reaches
// SettingsService's generated bindings -- this file is the one place
// that import lives, so the frame runtime's own build graph never sees
// it.
export function settingsPluginStorageDoors(pluginId: string): PluginStorageDoors {
	return {
		set: (key, _value, literal) => SettingsService.SetPluginStorageValue(pluginId, key, literal),
		delete: (key) => SettingsService.DeletePluginStorageValue(pluginId, key),
	}
}
