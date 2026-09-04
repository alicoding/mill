import type { ReactNode } from 'react'
import type { Icon } from '@primer/octicons-react'
import type { ContextMenuItem, ContextMenuState } from './ContextMenu'

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
  label: string
  onClick: () => void
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
  else action.onClick()
}

export function menuActionsToContextMenuItems(actions: InventoryMenuAction[], requestConfirm: (a: InventoryMenuAction) => void): ContextMenuItem[] {
  return actions.map((action, i) => ({
    id: `${action.label}-${i}`,
    label: action.label,
    danger: action.danger,
    run: () => runMenuAction(action, requestConfirm),
  }))
}
