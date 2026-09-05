import type { ReactNode } from 'react'
import type { Icon } from '@primer/octicons-react'
import type { CommandContext } from './commandContext'
import { commandAvailable, commandLabel, findCommand, runCommand } from './commands'
import type { ContextMenuItem, ContextMenuState } from './contextMenuItem'

// The inventory row's data contract, split out of InventoryList.tsx so
// the row component and the list surface can both import it without a
// cycle (docs/goals/0337). Re-exported from InventoryList.tsx, which
// stays the import site every page already uses.

export interface InventoryItemIcon {
  Icon: Icon
  bg: string
  fg: string
}

export interface InventoryMenuAction {
  // A registry command id plus the row's own target (goal 0343): the
  // action's label, its enablement and its effect all come from the
  // command, so a row supplies WHICH entity and nothing else. label/
  // onClick remain for the actions whose effect is not yet a
  // registered command.
  commandId?: string
  ctx?: CommandContext
  label?: string
  onClick?: () => void
  danger?: boolean
  // Opt-in confirmation (Button-semantics rule (b), .claude/rules/
  // frontend.md): when set, selecting this action shows ConfirmDialog
  // naming the entity before onClick fires, instead of destroying
  // straight off the kebab click. Every current caller sets this only
  // on a Delete action.
  confirm?: { title: string; body: string }
}

export interface InventoryItem {
  id: string
  // Rendered as data-entity on the row -- the executable form of the
  // goal's "recognition, not confirmation" acceptance bar (a test can
  // assert two pages render different data-entity values without
  // reading any text).
  entity: string
  icon: InventoryItemIcon
  label: string
  labelBadges?: ReactNode
  description?: string
  // Extra text the list's own search matches, beyond the label and the
  // description: a row's tags and its field NAMES, so a search finds an
  // entry by what it carries without any of it being rendered.
  searchTerms?: string[]
  // A seeded example rather than something the user authored. Drives
  // the Examples group at the bottom of the list (docs/goals/0337); the
  // per-row built-in badge stays a caller-supplied labelBadge.
  builtIn?: boolean
  // Raw wire timestamps backing the toolbar's sort menu. Distinct from
  // updatedLabel, which is the already-formatted caption -- a rendered
  // relative time can't be ordered.
  updatedAt?: string
  createdAt?: string
  // A short, muted relative-time caption ("2m ago") rendered in the
  // trailing metadata area (docs/SPEC.md §3.8's InventoryList entry --
  // inventories default-sort last-updated-first; this is the row-level
  // cue that order). Omitted entirely (not even a blank space) for an
  // unstamped/legacy entity -- shared/inventorySort.ts's formatUpdated
  // already returns '' for that case.
  updatedLabel?: string
  meta?: ReactNode
  primaryAction?: ReactNode
  onOpen: () => void
  menuActions: InventoryMenuAction[]
}

export interface InventoryEmptyState {
  icon: Icon
  heading: string
  description: string
  action?: ReactNode
}

export type ContextMenuOpener = (state: ContextMenuState) => void

// The kebab/right-click convergence (goal 0075's audit G1): a row's
// action list is authored once (InventoryMenuAction[]) and rendered
// through two openers -- the kebab's ActionMenu and a right-click
// ContextMenu -- via this single run path, so a confirm-guarded action
// always shows ConfirmDialog regardless of which opener fired it.
export function runMenuAction(action: InventoryMenuAction, requestConfirm: (a: InventoryMenuAction) => void) {
  if (action.confirm) requestConfirm(action)
  else performMenuAction(action)
}

// The unconfirmed effect, also called by ConfirmDialog's own onConfirm
// once the user has said yes.
export function performMenuAction(action: InventoryMenuAction) {
  // The row's own closure wins when it has one -- an action pairing a
  // commandId with onClick names the command only for its label.
  if (action.onClick) action.onClick()
  else if (action.commandId) void runCommand(action.commandId, action.ctx)
}

// The row's own label for an action: its literal, else the command's
// (a locale KEY resolved through commandLabel, goal 0341).
export function menuActionLabel(action: InventoryMenuAction): string {
  if (action.label) return action.label
  const command = action.commandId ? findCommand(action.commandId) : undefined
  return command ? commandLabel(command) : (action.commandId ?? '')
}

// Unavailable means ABSENT (goal 0343) -- the kebab and the right-click
// menu both drop an action whose command can't act on this row, the
// same rule the palette and ContextMenu follow.
export function menuActionAvailable(action: InventoryMenuAction): boolean {
  if (action.onClick) return true
  if (!action.commandId) return true
  const command = findCommand(action.commandId)
  return Boolean(command) && commandAvailable(command!, action.ctx)
}

export function visibleMenuActions(actions: InventoryMenuAction[]): InventoryMenuAction[] {
  return actions.filter(menuActionAvailable)
}

export function menuActionsToContextMenuItems(actions: InventoryMenuAction[], requestConfirm: (a: InventoryMenuAction) => void): ContextMenuItem[] {
  return visibleMenuActions(actions).map((action, i) => ({
    id: `${menuActionLabel(action)}-${i}`,
    label: menuActionLabel(action),
    danger: action.danger,
    run: () => runMenuAction(action, requestConfirm),
  }))
}
