import { describe, expect, it } from 'vitest'
import type { CanvasObjectContribution, ManifestContributes, MenuItemContribution } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { canvasContextMenuSeatItems, viewTitleSeatItems, type LoadedPluginContributes } from './pluginMenuSeats'

// goal 0349 S2b's seat-wiring contract: which loaded plugin's
// editor/context/view-title items apply to a given object kind/view.

function contributes(partial: Partial<ManifestContributes>): ManifestContributes {
  return {
    canvasObjects: null,
    steps: null,
    captures: null,
    settings: null,
    configuration: null,
    menus: null,
    network: null,
    views: null,
    commands: null,
    themes: null,
    secretSources: null,
    tools: null,
    mcpServers: null,
    ...partial,
  }
}

function kind(kindName: string): CanvasObjectContribution {
  return { kind: kindName, fileExtensions: null, pastesURLs: false, entry: '', example: null }
}

function menuItem(command: string): MenuItemContribution {
  return { command, when: '', group: '' }
}

describe('canvasContextMenuSeatItems', () => {
  it('seats a canvas-owning plugin\'s editor/context items only on its own kind', () => {
    const plugins: LoadedPluginContributes[] = [
      { pluginId: 'drawing', contributes: contributes({ canvasObjects: [kind('shape'), kind('pencil')], menus: { 'editor/context': [menuItem('drawingTips')] } }) },
    ]
    expect(canvasContextMenuSeatItems('shape', plugins)).toEqual([{ pluginId: 'drawing', commandId: 'plugin.drawing.drawingTips' }])
    expect(canvasContextMenuSeatItems('other-kind', plugins)).toEqual([])
  })

  it('seats a kindless plugin\'s editor/context items on every object', () => {
    const plugins: LoadedPluginContributes[] = [
      { pluginId: 'global-menu', contributes: contributes({ menus: { 'editor/context': [menuItem('globalAction')] } }) },
    ]
    expect(canvasContextMenuSeatItems('shape', plugins)).toEqual([{ pluginId: 'global-menu', commandId: 'plugin.global-menu.globalAction' }])
    expect(canvasContextMenuSeatItems('unrelated', plugins)).toEqual([{ pluginId: 'global-menu', commandId: 'plugin.global-menu.globalAction' }])
  })

  it('ignores a commandPalette or view/title entry -- only the canvasContextMenu seat counts', () => {
    const plugins: LoadedPluginContributes[] = [
      { pluginId: 'p', contributes: contributes({ menus: { commandPalette: [menuItem('a')], 'view/title': [menuItem('b')] } }) },
    ]
    expect(canvasContextMenuSeatItems('anything', plugins)).toEqual([])
  })
})

describe('viewTitleSeatItems', () => {
  it('seats a plugin\'s view/title items, ignoring other seats', () => {
    const plugins: LoadedPluginContributes[] = [
      { pluginId: 'tester', contributes: contributes({ menus: { 'view/title': [menuItem('sendAgain')], 'editor/context': [menuItem('other')] } }) },
    ]
    expect(viewTitleSeatItems('tester', plugins)).toEqual([{ pluginId: 'tester', commandId: 'plugin.tester.sendAgain' }])
  })

  it('answers empty for a plugin with no view/title entries or an unknown plugin id', () => {
    const plugins: LoadedPluginContributes[] = [{ pluginId: 'tester', contributes: contributes({}) }]
    expect(viewTitleSeatItems('tester', plugins)).toEqual([])
    expect(viewTitleSeatItems('missing', plugins)).toEqual([])
  })
})
