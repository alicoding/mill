import i18n from 'i18next'
import type { Command } from './commands'
import { entityContext } from './commandContext'
import { useAppStore } from './store'
import { useUISignalStore } from './uiSignalStore'
import { SettingsService } from './bindings'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import { pushNotice } from './noticeStore'
import { removePluginNow } from './pluginHostCommands'
import { entityRowCommands } from './entityRowCommands'
import { refreshDisabledExtensions, useExtensionEnablementStore } from './extensionEnablementStore'
import { pluginLoadStates } from '../plugins/loader'
import { ConfigureService } from './bindings'
import { appTranslate, messageFor } from './userError'
import { checkForUpdatesWithNotice, updateAllWithNotice, updateCandidateFor, useExtensionUpdatesStore } from './extensionUpdatesStore'

// The Extensions surface's own commands (docs/goals/0349). The page
// itself is one nav command; every ROW action is a command taking the
// row as its context, so the kebab menu, the palette and a keyboard
// path all act through the same declaration and the same enablement.
//
// EXTENSION_ENTITY is the context family these commands serve -- a
// command here reads nothing from a workflow or card context.
export const EXTENSION_ENTITY = 'plugin'

function extensionName(id: string): string {
  return pluginLoadStates().get(id)?.info.Manifest.name || id
}

// A plugin Mill knows is not a plugin Mill LOADED: a folder installed
// after boot has a row and a receipt but no load state until the next
// load. Enablement therefore asks the one question that is true of
// every row -- is this one of Mill's own bundled plugins, which cannot
// be turned off or removed -- and leaves the rest to the service.
function builtIn(id: string): boolean {
  return pluginLoadStates().get(id)?.info.Builtin === true
}

// One descriptor for the installed-extension row (goal 0346 slice B).
// No `load`: a folder installed after boot has a row and a receipt but
// no load state until the next load, so every command acts on the id
// the row hands it and asks the one question true of every row --
// is this one of Mill's own bundled plugins.
const EXTENSION_ROW_COMMANDS: Command[] = entityRowCommands<{ ID: string; Label: string }>({
  entity: EXTENSION_ENTITY,
  namespace: 'extension',
  labelOf: extensionName,
  refetch: () => {},
  toggles: [{
    on: { suffix: 'enable', label: 'commands.extension.enable' },
    off: { suffix: 'disable', label: 'commands.extension.disable' },
    isOn: (item) => !useExtensionEnablementStore.getState().disabledExtensionIds.includes(item.ID),
    set: (item, on) => SettingsService.SetExtensionEnabled(item.ID, on).then(refreshDisabledExtensions),
    enabled: (item) => !builtIn(item.ID),
  }],
  extras: [{
    // A built-in lives in the binary, so there is no folder to reveal.
    suffix: 'reveal',
    label: 'commands.extension.reveal',
    enabled: (item) => !builtIn(item.ID),
    run: () => PluginService.RevealPluginsDir(),
  }],
  remove: {
    suffix: 'remove',
    label: 'commands.extension.remove',
    undo: false,
    confirm: {
      title: 'views:settings.extensions.removeConfirmTitle',
      body: 'views:settings.extensions.removeConfirmBody',
      confirmLabel: 'views:settings.extensions.removeConfirmButton',
    },
    run: (item) => removePluginNow(item.ID, item.Label),
  },
}).map((command) => ({ ...command, paletteHidden: true }))

export const EXTENSIONS_COMMANDS: Command[] = [
  {
    // The store is its own destination, not a Settings pane. ⇧⌘X is
    // free in this registry: no other command binds Shift+Cmd+X.
    id: 'extensions.open',
    menu: { path: 'view', group: 0, order: 8, label: 'menu.items.extensions' },
    label: 'commands.extensions.open',
    defaultBinding: { mods: ['cmd', 'shift'], key: 'X' },
    keywords: ['extensions', 'plugins', 'marketplace', 'install', 'store'],
    run: () => useAppStore.getState().setView({ kind: 'extensions' }),
  },
  {
    id: 'extensions.sources',
    label: 'commands.extensions.sources',
    defaultBinding: null,
    keywords: ['marketplace', 'source', 'add source'],
    run: () => {
      useAppStore.getState().setView({ kind: 'extensions', tab: 'browse' })
      useUISignalStore.getState().requestExtensionSources()
    },
  },
  // enable/disable/reveal/remove are minted by the row-command factory
  // below (goal 0346 slice B), the same descriptor every Configure
  // family uses -- their ids and labels are unchanged.
  ...EXTENSION_ROW_COMMANDS,
  {
    // Check for updates is the one user action that asks every source
    // and every installed extension's own source for a newer version;
    // the entity-scoped twin below is the row menu's short label.
    id: 'extensions.checkUpdates',
    label: 'commands.extensions.checkUpdates',
    defaultBinding: null,
    keywords: ['update', 'upgrade', 'extensions', 'check'],
    run: () => checkForUpdatesWithNotice(),
  },
  {
    id: 'extension.checkUpdates',
    label: 'commands.extension.checkUpdates',
    defaultBinding: null,
    needs: 'entity',
    paletteHidden: true,
    enabled: (ctx) => {
      const target = entityContext(ctx, EXTENSION_ENTITY)
      return !!target && !builtIn(target.id)
    },
    run: () => checkForUpdatesWithNotice(),
  },
  {
    id: 'extensions.updateAll',
    label: 'commands.extensions.updateAll',
    defaultBinding: null,
    keywords: ['update all', 'upgrade', 'extensions'],
    enabled: () => useExtensionUpdatesStore.getState().candidates.length > 0,
    run: () => updateAllWithNotice(),
  },
  {
    // Applying one update confirms through the Extensions page's own
    // dialog host, which shows the same prompt the first install did.
    id: 'extension.update',
    label: 'commands.extension.update',
    defaultBinding: null,
    needs: 'entity',
    paletteHidden: true,
    enabled: (ctx) => {
      const target = entityContext(ctx, EXTENSION_ENTITY)
      return !!target && updateCandidateFor(target.id) !== undefined
    },
    run: (ctx) => {
      const target = entityContext(ctx, EXTENSION_ENTITY)
      if (!target) return
      useUISignalStore.getState().requestExtensionUpdate(target.id)
    },
  },
  {
    // The context id is "<plugin>/<server>": one command serves every
    // declared server, the same id-carries-the-argument shape the
    // per-plugin reload and remove commands take.
    id: 'extension.addMcpServer',
    label: 'commands.extension.addMcpServer',
    defaultBinding: null,
    needs: 'entity',
    paletteHidden: true,
    enabled: (ctx) => {
      const target = entityContext(ctx, EXTENSION_ENTITY)
      return !!target && parseMcpServerEntityID(target.id) !== null
    },
    run: (ctx) => {
      const target = entityContext(ctx, EXTENSION_ENTITY)
      const parsed = target ? parseMcpServerEntityID(target.id) : null
      if (!parsed) return
      addMcpServerToConfigure(parsed.pluginId, parsed.serverId)
    },
  },
  {
    id: 'extension.refreshSources',
    label: 'commands.extension.refreshSources',
    defaultBinding: null,
    keywords: ['refresh', 'marketplace', 'sources'],
    run: () => refreshSourcesWithNotice(),
  },
]

// mcpServerEntityID / parseMcpServerEntityID carry a declared server
// through an entity context: the plugin id and the server id, joined
// by the one character neither slug may contain.
export function mcpServerEntityID(pluginId: string, serverId: string): string {
  return `${pluginId}/${serverId}`
}

export function parseMcpServerEntityID(id: string): { pluginId: string; serverId: string } | null {
  const [pluginId, serverId, ...rest] = id.split('/')
  if (!pluginId || !serverId || rest.length > 0) return null
  return { pluginId, serverId }
}

// addMcpServerToConfigure resolves the declared server -- every
// secret already a reference -- and creates the entity through
// Configure's own create door, the same one its form uses.
function addMcpServerToConfigure(pluginId: string, serverId: string): void {
  PluginService.ResolveMCPServer(pluginId, serverId)
    .then((cfg) => ConfigureService.CreateMCPServer(cfg.Label, cfg.Command, cfg.Args ?? [], cfg.Env ?? []).then(() => cfg.Label))
    .then((label) => pushNotice({ level: 'success', text: i18n.t('views:extensions.mcpServers.added', { label }) }))
    .catch((err) => pushNotice({ level: 'error', text: i18n.t('views:extensions.mcpServers.addFailed', { error: messageFor(err, appTranslate) }) }))
}

// refreshSourcesWithNotice re-reads every added source. The ONLY
// automatic thing about it is that it reports its own outcome: a
// refresh happens because someone pressed it, never on a timer.
export function refreshSourcesWithNotice(): void {
  void PluginService.RefreshMarketplaceSources()
    .then((problems) => {
      const failures = problems ?? []
      pushNotice(failures.length === 0
        ? { level: 'success', text: i18n.t('views:extensions.sourcesRefreshed') }
        : { level: 'error', text: i18n.t('views:extensions.sourcesRefreshFailed', { list: failures.join('; ') }) })
    })
    .catch((err) => pushNotice({ level: 'error', text: i18n.t('views:extensions.sourcesRefreshFailed', { list: String(err) }) }))
}
