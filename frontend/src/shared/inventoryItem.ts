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
  // A registry command id plus the row's own target (goals 0343/0346):
  // the action's label, its enablement and its effect all come from the
  // command, so a row supplies WHICH entity and nothing else. There is
  // deliberately NO closure field -- an action authored inline on the
  // row exists nowhere but that render, which is what put every row
  // action outside the registry before goal 0346. A new action is a
  // descriptor field on its family (shared/entityRowCommands.ts).
  commandId: string
  ctx: CommandContext
  // Presentation-only override, for the one label a command cannot
  // hold: a reset names the revision it would restore, which is data,
  // not a static key (shared/seedLifecycle.ts's describeSeedReset).
  label?: string
  danger?: boolean
  // Opt-in confirmation (Button-semantics rule (b), .claude/rules/
  // frontend.md): when set, selecting this action shows ConfirmDialog
  // naming the entity before the command fires, instead of destroying
  // straight off the kebab click. Every current caller sets this only
  // on a Delete action.
  confirm?: { title: string; body: string; confirmLabel?: string }
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
  // A disclosure expander the row renders under its own text (goal
  // 0367's dotenv key read-back is the first consumer): showLabel/
  // hideLabel are the button's text per state, and `content` renders
  // only while expanded -- ExamplesSection's own collapsed-means-
  // absent rule, per row. The row mounts it inside the item body, not
  // as a sibling, so the owning ActionList's role="list" keeps its
  // aria-required-children sound.
  disclosure?: {
    showLabel: string
    hideLabel: string
    expanded: boolean
    onToggle: (expanded: boolean) => void
    content: ReactNode
  }
  // Which backing this row belongs to (goal 0408 S2's merged Secrets
  // list: vault entries plus every source's own keys, in one list).
  // Undefined is the list's own "default" bucket -- rendered first,
  // with no header at all -- so a list with no grouped item anywhere
  // renders exactly as it did before this field existed.
  group?: InventoryItemGroup
  onOpen: () => void
  menuActions: InventoryMenuAction[]
}

export interface InventoryItemGroup {
  key: string
  label: string
  icon: InventoryItemIcon
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
  void runCommand(action.commandId, action.ctx)
}

// The row's own label for an action: its literal, else the command's
// (a locale KEY resolved through commandLabel, goal 0341).
export function menuActionLabel(action: InventoryMenuAction): string {
  if (action.label) return action.label
  const command = findCommand(action.commandId)
  return command ? commandLabel(command) : action.commandId
}

// Unavailable means ABSENT (goal 0343) -- the kebab and the right-click
// menu both drop an action whose command can't act on this row, the
// same rule the palette and ContextMenu follow.
export function menuActionAvailable(action: InventoryMenuAction): boolean {
  const command = findCommand(action.commandId)
  return command !== undefined && commandAvailable(command, action.ctx)
}

export function visibleMenuActions(actions: InventoryMenuAction[]): InventoryMenuAction[] {
  return actions.filter(menuActionAvailable)
}

// A right-click item carries the command itself, never a closure, so
// ContextMenu runs it through the registry and shows its live
// HotkeyHint. The one exception is a confirm-guarded action: the dialog
// belongs to the ROW that offers it, so that item keeps a run() long
// enough to raise it (the command still fires once the user says yes).
export function menuActionsToContextMenuItems(actions: InventoryMenuAction[]): ContextMenuItem[] {
  return visibleMenuActions(actions).map((action, i) => ({
    id: `${menuActionLabel(action)}-${i}`,
    commandId: action.commandId,
    ctx: action.ctx,
    label: menuActionLabel(action),
    danger: action.danger,
    confirm: action.confirm,
  }))
}

export interface InventoryItemRun {
  group?: InventoryItemGroup
  items: InventoryItem[]
}

// groupOrder reorders items into stable buckets (goal 0408 S2): every
// ungrouped item first (a list's own default bucket -- Secrets' vault
// entries), then one bucket per distinct group key, ordered
// alphabetically by the group's own label so the order is deterministic
// with no second, caller-supplied ranking. Stable WITHIN each bucket --
// Array.prototype.sort's own ES2019 guarantee, the same one
// listStandard.ts's sortItems already relies on -- so grouping never
// fights whichever sort (updated/name/created) the caller already
// applied.
export function groupOrder(items: InventoryItem[]): InventoryItem[] {
  const labels = new Map<string, string>()
  for (const item of items) {
    if (item.group && !labels.has(item.group.key)) labels.set(item.group.key, item.group.label)
  }
  const order = [...labels.keys()].sort((a, b) => labels.get(a)!.localeCompare(labels.get(b)!, undefined, { sensitivity: 'base' }))
  const rank = new Map(order.map((key, i) => [key, i + 1]))
  return [...items].sort((a, b) => (a.group ? rank.get(a.group.key)! : 0) - (b.group ? rank.get(b.group.key)! : 0))
}

// listRuns splits an already-ordered sequence (groupOrder's own output,
// or a page slice of it) into the contiguous runs InventoryList renders
// one header per -- never reorders, so a page starting mid-group still
// opens with that group's header rather than an unlabeled continuation.
export function listRuns(items: InventoryItem[]): InventoryItemRun[] {
  const runs: InventoryItemRun[] = []
  for (const item of items) {
    const last = runs[runs.length - 1]
    if (last && last.group?.key === item.group?.key) {
      last.items.push(item)
      continue
    }
    runs.push({ group: item.group, items: [item] })
  }
  return runs
}
