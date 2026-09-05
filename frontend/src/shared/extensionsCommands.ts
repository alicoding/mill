import i18n from 'i18next'
import type { Command } from './commands'
import { entityContext } from './commandContext'
import { useAppStore } from './store'
import { useUISignalStore } from './uiSignalStore'
import { SettingsService } from './bindings'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import { pushNotice } from './noticeStore'
import { removePluginNow } from './pluginHostCommands'
import { refreshDisabledExtensions, useExtensionEnablementStore } from './extensionEnablementStore'
import { pluginLoadStates } from '../plugins/loader'
import { background } from './background'

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

function installed(id: string): boolean {
  return pluginLoadStates().has(id)
}

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
  {
    id: 'extension.enable',
    label: 'commands.extension.enable',
    defaultBinding: null,
    needs: 'entity',
    paletteHidden: true,
    enabled: (ctx) => {
      const target = entityContext(ctx, EXTENSION_ENTITY)
      return !!target && installed(target.id) && useExtensionEnablementStore.getState().disabledExtensionIds.includes(target.id)
    },
    run: (ctx) => {
      const target = entityContext(ctx, EXTENSION_ENTITY)
      if (!target) return
      void background(SettingsService.SetExtensionEnabled(target.id, true).then(refreshDisabledExtensions), 'extension.enable')
    },
  },
  {
    id: 'extension.disable',
    label: 'commands.extension.disable',
    defaultBinding: null,
    needs: 'entity',
    paletteHidden: true,
    enabled: (ctx) => {
      const target = entityContext(ctx, EXTENSION_ENTITY)
      return !!target && installed(target.id) && !useExtensionEnablementStore.getState().disabledExtensionIds.includes(target.id)
    },
    run: (ctx) => {
      const target = entityContext(ctx, EXTENSION_ENTITY)
      if (!target) return
      void background(SettingsService.SetExtensionEnabled(target.id, false).then(refreshDisabledExtensions), 'extension.disable')
    },
  },
  {
    id: 'extension.reveal',
    label: 'commands.extension.reveal',
    defaultBinding: null,
    needs: 'entity',
    paletteHidden: true,
    // A built-in lives in the binary, so there is no folder to reveal.
    enabled: (ctx) => {
      const target = entityContext(ctx, EXTENSION_ENTITY)
      return !!target && installed(target.id) && !pluginLoadStates().get(target.id)?.info.Builtin
    },
    run: () => { void background(PluginService.RevealPluginsDir(), 'extension.reveal') },
  },
  {
    id: 'extension.remove',
    label: 'commands.extension.remove',
    defaultBinding: null,
    needs: 'entity',
    paletteHidden: true,
    enabled: (ctx) => {
      const target = entityContext(ctx, EXTENSION_ENTITY)
      return !!target && installed(target.id) && !pluginLoadStates().get(target.id)?.info.Builtin
    },
    run: (ctx) => {
      const target = entityContext(ctx, EXTENSION_ENTITY)
      if (!target) return
      removePluginNow(target.id, extensionName(target.id))
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
