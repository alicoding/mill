import type { CommandContext } from './commandContext'
import { commandAvailable, commandLabel, findCommand } from './commands'

// The right-click menu's data contract, split out of ContextMenu.tsx so
// the pure availability/label rules below stay unit-testable without
// pulling Primer's JSX in (the same component/non-component seam
// shared/inventoryItem.ts established). ContextMenu.tsx re-exports the
// types, so every existing import site is unchanged.
//
// An item IS a registry command plus the target it acts on (goal 0343,
// goal 0346 slice B): the surface supplies WHICH thing, never what the
// action does. There is no closure form -- an action written inline on
// a menu exists nowhere but that render, unreachable from the palette,
// unbindable, its label duplicated per surface. The `no-restricted-
// syntax` rule in eslint.config.js refuses a `run:` property on one of
// these literals for the same reason InventoryMenuAction refuses
// `onClick:`.
export interface ContextMenuItem {
  id: string
  commandId?: string
  ctx?: CommandContext
  // A question to ask before the command runs. The command's own
  // confirm(ctx) is the default; a surface states this only for a
  // question the command cannot phrase itself.
  confirm?: { title: string; body: string; confirmLabel?: string }
  // A literal label for the two non-command rows: a submenu head and
  // an item whose surface-specific wording differs from the command's.
  label?: string
  danger?: boolean
  divider?: boolean
  // A nested list opened in place of this menu (the click-to-drill
  // shape "Change link kind" and "Add to perspective" take); the head
  // itself runs nothing and is absent when nothing below it is.
  submenu?: ContextMenuItem[]
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
// check and always shows; a submenu head shows only while something
// under it does.
export function contextMenuItemAvailable(item: ContextMenuItem): boolean {
  if (item.submenu) return visibleContextMenuItems(item.submenu).length > 0
  if (!item.commandId) return true
  const command = findCommand(item.commandId)
  return Boolean(command) && commandAvailable(command!, item.ctx)
}

// The label a menu row shows: the item's own literal, else the
// command's label resolved for this item's target (goal 0341 --
// Command.label holds a KEY, never a sentence; goal 0346 slice B --
// labelFor composes "Open <title>" from the context), else the id as
// a last resort.
export function contextMenuItemLabel(item: ContextMenuItem): string {
  if (item.label) return item.label
  const command = item.commandId ? findCommand(item.commandId) : undefined
  return command ? commandLabel(command, item.ctx) : item.id
}

// The question to ask before this item runs, if any: the item's own,
// else the command's for this target.
export function contextMenuItemConfirm(item: ContextMenuItem): { title: string; body: string; confirmLabel?: string } | null {
  if (item.confirm) return item.confirm
  const command = item.commandId ? findCommand(item.commandId) : undefined
  return command?.confirm?.(item.ctx) ?? null
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
