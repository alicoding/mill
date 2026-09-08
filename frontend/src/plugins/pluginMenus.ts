import type { ManifestContributes, MenuItemContribution } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

// The frontend half of pluginsvc's contributes.menus classification
// (docs/goals/0349 S2, pluginservice_menus.go's Go twin): the ONE
// table a VS Code menu id maps through on this side of the wire. Which
// live surface each seat wires into is a later slice's job -- this
// module only answers "does Mill recognise this id, and if so, onto
// which seat" so a porting author's manifest is classified the same
// way the loader classified it.
export type MenuSeat = 'commandPalette' | 'canvasContextMenu' | 'viewTitle'

export const MENU_SEAT_BY_VSCODE_ID: Readonly<Record<string, MenuSeat>> = {
  commandPalette: 'commandPalette',
  'editor/context': 'canvasContextMenu',
  'view/title': 'viewTitle',
}

export interface MenuSeatContribution {
  command: string
  seat: MenuSeat
  when?: string
  group?: string
}

export interface ResolvedMenus {
  seated: MenuSeatContribution[]
  unknownMenuIds: string[]
}

// resolveMenus mirrors ResolveMenus (pluginservice_menus.go): seated
// carries every entry whose VS Code menu id Mill recognises, in sorted
// id order; unknownMenuIds names every id it does not, also sorted.
export function resolveMenus(menus: ManifestContributes['menus'] | undefined): ResolvedMenus {
  const seated: MenuSeatContribution[] = []
  const unknownMenuIds: string[] = []
  const ids = Object.keys(menus ?? {}).sort()
  for (const id of ids) {
    const seat = MENU_SEAT_BY_VSCODE_ID[id]
    const items: MenuItemContribution[] = menus?.[id] ?? []
    if (!seat) {
      if (items.length > 0) unknownMenuIds.push(id)
      continue
    }
    for (const item of items) {
      seated.push({ command: item.command, seat, when: item.when || undefined, group: item.group || undefined })
    }
  }
  return { seated, unknownMenuIds }
}
