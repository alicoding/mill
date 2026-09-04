import type { CommandContext } from './commandContext'
import { commandAvailable, commandLabel, findCommand } from './commands'

// The right-click menu's data contract, split out of ContextMenu.tsx so
// the pure availability/label rules below stay unit-testable without
// pulling Primer's JSX in (the same component/non-component seam
// shared/inventoryItem.ts established). ContextMenu.tsx re-exports the
// types, so every existing import site is unchanged.
export interface ContextMenuItem {
  id: string
  // A registry command id and the row's own target (goal 0343). An
  // item naming a command and NO run() of its own takes its label, its
  // enablement and its execution from the command -- the surface
  // supplies WHICH row, never what the action does.
  //
  // An item carrying BOTH is the older pairing (goal 0075): the
  // commandId is there for the label and the HotkeyHint, while the
  // closure is the real action, because the command it names acts on a
  // live selection the registry cannot see. Its own run() wins, and its
  // enablement is the surface's to decide -- so such an item is never
  // filtered out by the command's enabled().
  commandId?: string
  ctx?: CommandContext
  label?: string
  danger?: boolean
  divider?: boolean
  run?: () => void
}

export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

// Unavailable means ABSENT, not dimmed (goal 0343): Apple's HIG hides
// an inapplicable context-menu item, and the command palette already
// omits a command whose enabled() is false -- one rule for every menu
// rather than two. An item with no commandId has no enablement to
// check and always shows; a surface that used to pass `disabled` now
// simply doesn't build the item.
export function contextMenuItemAvailable(item: ContextMenuItem): boolean {
  // The surface owns this item's action, so it owns whether to offer it
  // -- it simply doesn't build the item otherwise.
  if (item.run) return true
  if (!item.commandId) return true
  const command = findCommand(item.commandId)
  return Boolean(command) && commandAvailable(command!, item.ctx)
}

// The label a menu row shows: the item's own literal, else the
// command's label resolved through the locale registry (goal 0341 --
// Command.label holds a KEY, never a sentence), else the id as a last
// resort.
export function contextMenuItemLabel(item: ContextMenuItem): string {
  if (item.label) return item.label
  const command = item.commandId ? findCommand(item.commandId) : undefined
  return command ? commandLabel(command) : item.id
}

// Omitting items can leave a divider first, last, or next to another
// divider -- a separator with nothing to separate. Dropped here so no
// surface has to reason about it.
export function visibleContextMenuItems(items: ContextMenuItem[]): ContextMenuItem[] {
  const out: ContextMenuItem[] = []
  for (const item of items.filter(contextMenuItemAvailable)) {
    if (item.divider && (out.length === 0 || out[out.length - 1].divider)) continue
    out.push(item)
  }
  while (out.length > 0 && out[out.length - 1].divider) out.pop()
  return out
}
