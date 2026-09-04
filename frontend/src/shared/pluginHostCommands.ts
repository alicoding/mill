import i18n from 'i18next'
import type { Command } from './commands'
import { SettingsService } from './bindings'
import { pushNotice } from './noticeStore'
import { notifyPluginRemoved } from './pluginRemoveSignal'
import { pluginLoadStates } from '../plugins/loader'
import { drainedPluginCommands } from '../plugins/pluginCommands'

// Uninstall, as an ordinary registry command (goal 0321): one
// `plugin.remove.<id>` per scanned plugin, the id-carries-the-argument
// shape every other parameterized command here uses
// (atlas.create.<kind>, plugin.reload.<id>, settings.open.<group>).
// The Extensions detail pane's … menu RENDERS this command rather than
// calling the service itself, so the palette and the menu remove a
// plugin exactly the same way.
//
// Read from the loader's boot scan rather than a fresh RPC: the
// command table is built once per load (shared/commands.ts's lazy
// array), and by then every plugin folder has been scanned. A folder
// added while Mill is running has no row and no command until the next
// load -- the same "plugins load at app start" contract the reload
// command already lives under.
//
// enabled(): installed and not one of Mill's own bundled plugins. The
// service refuses a built-in anyway; declaring it here is what keeps
// the row out of the palette instead of offering an action that fails.
export function removePluginNow(id: string, name: string): void {
  SettingsService.RemovePlugin(id)
    .then((destination) => {
      notifyPluginRemoved()
      pushNotice({
        level: 'success',
        text: `${i18n.t('views:settings.extensions.removed', { name })} ${i18n.t('views:settings.extensions.removedLocation', { path: destination })}`,
      })
    })
    .catch((err) => {
      pushNotice({
        level: 'error',
        text: i18n.t('views:settings.extensions.removeFailed', { name, error: String(err) }),
      })
    })
}

// pluginRegistryCommands is the ONE spread shared/commands.ts takes
// for everything plugin-related: what plugins themselves contributed
// (drained from the collector activation filled before that module
// evaluated -- main.tsx's boot order), plus the host's own per-plugin
// actions. Never default-bound: a keybinding for third-party code is
// assigned in Settings, never shipped by the plugin.
export function pluginRegistryCommands(): Command[] {
  return [
    ...drainedPluginCommands().map((c): Command => ({ id: c.id, label: c.label, defaultBinding: null, surface: c.surface, enabled: c.enabled, run: c.run })),
    ...pluginRemoveCommands(),
  ]
}

function pluginRemoveCommands(): Command[] {
  const out: Command[] = []
  for (const [id, state] of pluginLoadStates()) {
    if (state.info.Builtin) continue
    const name = state.info.Manifest.name || id
    out.push({
      id: `plugin.remove.${id}`,
      label: `Remove ${name}`,
      defaultBinding: null,
      enabled: () => pluginLoadStates().has(id) && !pluginLoadStates().get(id)?.info.Builtin,
      run: () => removePluginNow(id, name),
    })
  }
  return out
}
