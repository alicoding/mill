import type { Command } from './commands'
import { commandAvailable } from './commands'
import { AMBIENT_CONTEXT_KINDS, ambientContext } from './ambientContext'
import { copy } from './copy'
import type { KeyCombo } from './keybinding'
import type { View } from './store'
import { toWailsAccelerator } from './menuAccelerator'
import { MENU_SKELETON, type MenuPath, type MenuRole, type MenuSlot } from './menuSkeleton'

export type { MenuPath, MenuRole } from './menuSkeleton'

// Where a command sits in the native menu bar. A command without one is
// simply absent from the menu bar -- the palette and its keybinding are
// unaffected.
//
// `group` is the separator band inside the menu (bands render in
// ascending order with a separator between them, and an empty band
// renders nothing at all); `order` positions the item inside its band.
// `label` overrides the command's palette label for the menu only, for
// the handful of entries whose menu wording is shorter than the
// palette's ("Home", not "Go to Home").
export interface MenuPlacement {
  path: MenuPath
  group: number
  order: number
  label?: string
}

export type MenuEntry =
  | { kind: 'command'; id: string; label: string; accelerator: string | null; enabled: boolean }
  | { kind: 'role'; role: MenuRole; releaseAccelerator: boolean }
  | { kind: 'submenu'; label: string; groups: MenuEntry[][] }

export type MenuNode =
  | { kind: 'menu'; label: string; groups: MenuEntry[][] }
  // A whole menu Wails builds from a role, contents and all -- Edit,
  // whose items are the platform's own text-editing responders.
  | { kind: 'roleMenu'; label: string; role: MenuRole }

export interface MenuSpec {
  menus: MenuNode[]
}

// A menu seat whose command, label and enablement follow application
// state rather than the registry's own static placement (goal 0335):
// the update seat shows update.check/downloadAndInstall/relaunch by
// turn, the vault seat shows secrets.lockVault/unlockVault by turn.
// Keyed in MenuSpecContext.seatOverrides by the ANCHOR command id --
// the one that actually declares `menu` (its path/group/order is the
// seat's fixed position) -- so its physical slot never moves while
// what occupies it does.
export interface SeatOverride {
  commandId: string
  label: string
  enabled: boolean
}

// What the projection needs beyond the registry itself. `surface` is
// the view the user is looking at, which decides whether a
// surface-scoped command's item is live; `overrides` is the user's own
// keybinding map, so a rebound command's menu item shows (and takes)
// the combo actually in force rather than the shipped default.
export interface MenuSpecContext {
  surface?: View['kind']
  overrides?: Record<string, KeyCombo>
  seatOverrides?: Record<string, SeatOverride>
}

// Whether a command's menu item is live right now. Folds in the surface
// scope the same way the keydown dispatcher does (commands.ts's
// dispatchCommandForEvent): a command scoped to Atlas is not a valid
// action anywhere else, so its menu item is dead there too -- and,
// because macOS never fires a disabled item's key equivalent, that is
// also what keeps a surface-scoped accelerator from firing off-surface.
// A command over a target reads the ambient one (goal 0346 slice B):
// the menu bar's "Delete selection" is live exactly while the board
// has a selection, the way the palette's is.
export function commandMenuEnabled(command: Command, activeSurface?: View['kind']): boolean {
  if (command.surface && activeSurface !== undefined && !command.surface.includes(activeSurface)) return false
  return commandAvailable(command, ambientContext())
}

// The combos the native menu bar takes ownership of. Computed off each
// seat's ANCHOR command, never a seatOverride's target -- every command
// a seatOverride can name (update.check/downloadAndInstall/relaunch,
// secrets.lockVault/unlockVault) ships with defaultBinding: null, so
// there is never an accelerator to reassign when the seat's occupant
// changes; commandEntry above still reads the live target's own
// accelerator, this map just never needs to know about the swap. A
// combo claimed by MORE than one menu-placed command is deliberately
// left out: macOS resolves a duplicate key equivalent by menu order
// alone, which cannot
// express the surface precedence the keydown dispatcher already
// implements (⌘K is the Atlas jump dialog on Atlas and the palette
// everywhere else), so both commands keep their existing in-window
// owner and their menu items stay click-only.
export function menuOwnedAccelerators(commands: Command[], overrides: Record<string, KeyCombo> = {}): Map<string, string> {
  const claims = new Map<string, string[]>()
  for (const command of menuPlacedCommands(commands)) {
    const accelerator = acceleratorFor(command, overrides)
    if (!accelerator) continue
    claims.set(accelerator, [...(claims.get(accelerator) ?? []), command.id])
  }
  const owned = new Map<string, string>()
  for (const [accelerator, ids] of claims) {
    if (ids.length === 1) owned.set(accelerator, ids[0])
  }
  return owned
}

// menuSpecFor projects the command registry onto the native menu bar:
// the skeleton below supplies the standard roles and the menu order,
// every other item is a command that asked for a place. Pure -- the
// caller owns pushing the result at the platform.
export function menuSpecFor(commands: Command[], ctx: MenuSpecContext = {}): MenuSpec {
  const { surface: activeSurface, overrides = {}, seatOverrides = {} } = ctx
  const owned = menuOwnedAccelerators(commands, overrides)
  const byPath = new Map<MenuPath, Command[]>()
  for (const command of menuPlacedCommands(commands)) {
    const path = placementOf(command)!.path
    byPath.set(path, [...(byPath.get(path) ?? []), command])
  }
  const byId = new Map(commands.map((c) => [c.id, c]))

  const expand = (path: MenuPath, groups: MenuSlot[][]): MenuEntry[][] =>
    groups
      .map((slots) => slots.flatMap((slot) => expandSlot(path, slot, byPath, byId, owned, activeSurface, overrides, seatOverrides)))
      .filter((entries) => entries.length > 0)

  return {
    menus: MENU_SKELETON.map((menu): MenuNode =>
      menu.role
        ? { kind: 'roleMenu', label: copy(menu.label), role: menu.role }
        : { kind: 'menu', label: copy(menu.label), groups: expand(menu.path, menu.groups ?? []) },
    ),
  }
}

function expandSlot(
  path: MenuPath,
  slot: MenuSlot,
  byPath: Map<MenuPath, Command[]>,
  byId: Map<string, Command>,
  owned: Map<string, string>,
  activeSurface: View['kind'] | undefined,
  overrides: Record<string, KeyCombo>,
  seatOverrides: Record<string, SeatOverride>,
): MenuEntry[] {
  if ('role' in slot) return [{ kind: 'role', role: slot.role, releaseAccelerator: slot.releaseAccelerator ?? false }]
  if ('submenu' in slot) {
    const groups = slot.submenu.groups
      .map((slots) => slots.flatMap((s) => expandSlot(slot.submenu.path, s, byPath, byId, owned, activeSurface, overrides, seatOverrides)))
      .filter((entries) => entries.length > 0)
    return groups.length === 0 ? [] : [{ kind: 'submenu', label: copy(slot.submenu.label), groups }]
  }
  if ('commandRef' in slot) {
    const command = byId.get(slot.commandRef)
    return command && !command.paletteHidden ? [commandEntry(command, owned, activeSurface, overrides, byId, seatOverrides[command.id], slot.label)] : []
  }
  return (byPath.get(path) ?? [])
    .filter((command) => placementOf(command)!.group === slot.commandGroup)
    .sort((a, b) => placementOf(a)!.order - placementOf(b)!.order)
    .map((command) => commandEntry(command, owned, activeSurface, overrides, byId, seatOverrides[command.id]))
}

function commandEntry(
  command: Command,
  owned: Map<string, string>,
  activeSurface: View['kind'] | undefined,
  overrides: Record<string, KeyCombo>,
  byId: Map<string, Command>,
  seatOverride: SeatOverride | undefined,
  labelOverride?: string,
): MenuEntry {
  // A seatOverride swaps which command actually occupies the anchor's
  // seat: the id the item fires, its accelerator (if any), and the
  // whole entry's label/enabled come from the override, never the
  // anchor's own -- the anchor's `menu` only ever fixes the seat's
  // position.
  const target = seatOverride ? (byId.get(seatOverride.commandId) ?? command) : command
  const accelerator = acceleratorFor(target, overrides)
  return {
    kind: 'command',
    id: target.id,
    label: copy(seatOverride?.label ?? labelOverride ?? placementOf(command)?.label ?? command.label),
    accelerator: accelerator && owned.get(accelerator) === target.id ? accelerator : null,
    enabled: seatOverride ? seatOverride.enabled : commandMenuEnabled(command, activeSurface),
  }
}

// A hintOnly command's combo is dispatched by a dedicated listener that
// can see a live selection the menu bar cannot (the canvas selection,
// the focused card), so its menu item is click-only -- taking the key
// equivalent natively would route the press away from the only listener
// that knows what it applies to.
function acceleratorFor(command: Command, overrides: Record<string, KeyCombo>): string | null {
  const binding = overrides[command.id] ?? command.defaultBinding
  if (command.hintOnly || !binding) return null
  return toWailsAccelerator(binding)
}

// A paletteHidden command needs a live, on-screen target the invoker
// has no way to supply (a focused row) -- exactly as true of a menu
// item as of a palette row, so a seat is not enough to put one in the
// bar; so is a command whose `needs` ambientContext() can never
// resolve (goal 0346 slice B: a canvas step, a tree row). Its keyboard
// shortcut and its context menu stay untouched; only the menu bar
// declines it.
export function menuPlaceable(command: Command): boolean {
  return command.menu !== undefined && !command.paletteHidden && (!command.needs || AMBIENT_CONTEXT_KINDS.includes(command.needs))
}

function menuPlacedCommands(commands: Command[]): Command[] {
  return commands.filter(menuPlaceable)
}

function placementOf(command: Command): MenuPlacement | undefined {
  return command.menu
}
