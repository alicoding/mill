import type { ManifestContributes } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { resolveMenus } from './pluginMenus'
import { pluginLoadStates } from './loader'

// The seat-wiring half pluginMenus.ts's own header comment defers to a
// later slice (docs/goals/0349 S2b): WHERE a resolved canvasContextMenu/
// viewTitle entry actually renders. Pure resolution lives here, over a
// plain snapshot of {pluginId, contributes} rather than the loader's
// own PluginLoadState map, so a test builds a fixture without a real
// PluginInfo/Manifest.

export interface LoadedPluginContributes {
  pluginId: string
  contributes: ManifestContributes
}

// loadedPluginContributes -- every 'loaded' plugin's own contributes
// block (goal 0349 S2b item 1's "disabled plugins never appear" rule):
// a plugin that is disabled, blocked, unsigned, errored, etc. never
// activated, so it seats nothing.
export function loadedPluginContributes(states = pluginLoadStates()): LoadedPluginContributes[] {
  const out: LoadedPluginContributes[] = []
  for (const [pluginId, state] of states) {
    if (state.status !== 'loaded') continue
    out.push({ pluginId, contributes: state.info.Manifest.contributes })
  }
  return out
}

export interface PluginMenuSeatItem {
  pluginId: string
  // The registered runtime command id (hostApi.ts's registerCommand
  // naming, `plugin.<pluginId>.<declared id>`) -- resolved here once so
  // every renderer just does findCommand(commandId).
  commandId: string
}

// canvasContextMenuSeatItems answers goal 0349 S2b's design contract
// item 1: a right-clicked object's kind decides which loaded plugins'
// editor/context items apply. A plugin that declares at least one
// canvasObjects kind seats its items only on ITS OWN kind(s) -- the
// object "belongs" to it. A plugin that declares none at all has no
// kind to scope an item to, so its editor/context items apply to
// every object's menu instead (the "without a kind filter" half of
// the contract).
export function canvasContextMenuSeatItems(objectKind: string, plugins: LoadedPluginContributes[] = loadedPluginContributes()): PluginMenuSeatItem[] {
  const out: PluginMenuSeatItem[] = []
  for (const { pluginId, contributes } of plugins) {
    const ownedKinds = contributes.canvasObjects ?? []
    if (ownedKinds.length > 0 && !ownedKinds.some((decl) => decl.kind === objectKind)) continue
    const { seated } = resolveMenus(contributes.menus)
    for (const item of seated) {
      if (item.seat === 'canvasContextMenu') out.push({ pluginId, commandId: `plugin.${pluginId}.${item.command}` })
    }
  }
  return out
}

// viewTitleSeatItems answers item 2: every view/title item the tab's
// OWNING plugin declared. contributes.menus carries no per-view
// scoping (VS Code's own `when` clause would narrow it; Mill evaluates
// none -- goal 0380 Decision 4), so a plugin with several views shows
// the same items on all of them.
export function viewTitleSeatItems(pluginId: string, plugins: LoadedPluginContributes[] = loadedPluginContributes()): PluginMenuSeatItem[] {
  const plugin = plugins.find((p) => p.pluginId === pluginId)
  if (!plugin) return []
  const { seated } = resolveMenus(plugin.contributes.menus)
  return seated.filter((item) => item.seat === 'viewTitle').map((item) => ({ pluginId, commandId: `plugin.${pluginId}.${item.command}` }))
}
