import { COMMANDS } from './commands'
import { formatCombo } from './keybinding'
import { MENU_ROLE_NAMES } from './menuSkeleton'
import { menuSpecFor } from './menuSpec'
import type { MenuEntry } from './menuSpec'

// One row per item the menu bar renders, flattened for the menu-bar
// reference page (userdocs/reference/menu-bar.md). The page is derived
// from the same projection the app installs, so an item cannot appear
// in one and not the other.
export interface MenuDocRow {
  menu: string
  item: string
  shortcut: string
  // The command id behind the item, or "" for a standard item macOS
  // supplies itself.
  command: string
}

export function menuDocRows(): MenuDocRow[] {
  const shortcuts = new Map(
    COMMANDS.filter((c) => c.defaultBinding).map((c) => [c.id, formatCombo(c.defaultBinding!.mods, c.defaultBinding!.key)]),
  )
  const rows: MenuDocRow[] = []
  const walk = (menu: string, entries: MenuEntry[]): void => {
    for (const entry of entries) {
      if (entry.kind === 'role') {
        rows.push({ menu, item: MENU_ROLE_NAMES[entry.role], shortcut: '', command: '' })
      } else if (entry.kind === 'command') {
        rows.push({ menu, item: entry.label, shortcut: shortcuts.get(entry.id) ?? '', command: entry.id })
      } else {
        for (const group of entry.groups) walk(`${menu} > ${entry.label}`, group)
      }
    }
  }
  for (const node of menuSpecFor(COMMANDS).menus) {
    if (node.kind === 'roleMenu') {
      rows.push({ menu: node.label, item: MENU_ROLE_NAMES[node.role], shortcut: '', command: '' })
      continue
    }
    for (const group of node.groups) walk(node.label, group)
  }
  return rows
}
