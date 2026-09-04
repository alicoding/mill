import { MenuService } from './bindings'
import type {
  MenuEntry as WireEntry,
  MenuNode as WireNode,
  MenuSpec as WireSpec,
} from '../../bindings/github.com/alicoding/mill/internal/adapters/windowing'
import { COMMANDS, effectiveBinding } from './commands'
import type { Command } from './commands'
import { comboKey } from './keybinding'
import { setMenuOwnedCombos } from './menuOwnership'
import { commandMenuEnabled, menuOwnedAccelerators, menuSpecFor } from './menuSpec'
import type { MenuEntry, MenuNode, MenuSpec, MenuSpecContext, SeatOverride } from './menuSpec'
import { useAppStore } from './store'
import { useUISignalStore } from './uiSignalStore'
import { useUpdateNoticeStore } from './updateNoticeStore'
import { useVaultStatusStore } from './vaultStatusStore'
import { useBuildInfoStore } from './buildInfoStore'
import { updateSeatFor } from './updateSeat'
import { vaultSeatFor } from './vaultSeat'
import { background } from './background'

// The page's half of the native menu bar (goal 0332): project the
// command registry, hand the projection to Go, then keep every item's
// live/dead state in step as the app's state moves. Go renders what it
// is given and never learns what a command means.

// How long enablement changes are collected before one push. A menu is
// only read when it is pulled down, so a burst of store writes (a view
// change fans out several) is worth one message, not one each.
const ENABLEMENT_DEBOUNCE_MS = 50

let lastVector: Record<string, boolean> = {}
let pending: ReturnType<typeof setTimeout> | undefined

// The state-following seats (goal 0335): computed fresh on every call
// from the two stores each seat's own pure function reads, keyed by
// the anchor command id shared/menuSpec.ts's commandEntry looks them
// up by.
function seatOverrides(): Record<string, SeatOverride> {
  const update = useUpdateNoticeStore.getState()
  return {
    'update.check': updateSeatFor(update.updateNoticeState, update.availableVersion),
    'secrets.lockVault': vaultSeatFor(useVaultStatusStore.getState().vaultStatus),
  }
}

export function menuContext(): MenuSpecContext {
  const state = useAppStore.getState()
  return { surface: state.view.kind, overrides: state.keybindingOverrides, seatOverrides: seatOverrides() }
}

// The combos the native menu bar takes over, in the keydown
// dispatcher's own vocabulary -- empty until an install actually
// succeeds, so server mode and the browser companion keep every combo.
function ownedCombos(ctx: MenuSpecContext): string[] {
  const overrides = ctx.overrides ?? {}
  const byId = new Map(COMMANDS.map((c) => [c.id, c]))
  const out: string[] = []
  for (const id of menuOwnedAccelerators(COMMANDS, overrides).values()) {
    const command = byId.get(id)
    const binding = command && effectiveBinding(command, overrides)
    if (binding) out.push(comboKey(binding.mods, binding.key))
  }
  return out
}

function menuPlaced(): Command[] {
  return COMMANDS.filter((c) => c.menu !== undefined)
}

// Keyed by the id actually INSTALLED at each seat, which for an
// overridden seat is the override's target, not the anchor -- Go's
// SetEnabled indexes the tree it was last given (menuinstall_desktop.go's
// commandItems), so a vector keyed by the anchor's own id would target
// nothing once a reinstall has swapped that seat's item to a different
// command.
function enablementVector(ctx: MenuSpecContext): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const command of menuPlaced()) {
    const seat = ctx.seatOverrides?.[command.id]
    if (seat) {
      out[seat.commandId] = seat.enabled
      continue
    }
    out[command.id] = commandMenuEnabled(command, ctx.surface)
  }
  return out
}

function changedEntries(next: Record<string, boolean>): Record<string, boolean> {
  const diff: Record<string, boolean> = {}
  for (const [id, on] of Object.entries(next)) {
    if (lastVector[id] !== on) diff[id] = on
  }
  return diff
}

// installNativeMenu pushes the whole tree. Reports whether a native
// menu bar took it; a false answer leaves every accelerator with the
// in-window dispatcher, which is correct wherever no menu bar exists.
export async function installNativeMenu(): Promise<boolean> {
  const ctx = menuContext()
  const installed = await MenuService.Install(toWire(menuSpecFor(COMMANDS, ctx)))
  lastVector = enablementVector(ctx)
  setMenuOwnedCombos(installed ? ownedCombos(ctx) : [])
  return installed
}

// pushMenuEnablement sends only what changed since the last push, so a
// store write that moves nothing the menu shows costs no message.
export function pushMenuEnablement(): void {
  const next = enablementVector(menuContext())
  const diff = changedEntries(next)
  lastVector = next
  if (Object.keys(diff).length === 0) return
  void background(MenuService.SetEnabled(diff), 'menu.setEnabled')
}

function scheduleEnablementPush(): void {
  if (pending !== undefined) return
  pending = setTimeout(() => {
    pending = undefined
    pushMenuEnablement()
  }, ENABLEMENT_DEBOUNCE_MS)
}

// The state-following seats' own signature: changes here mean a
// DIFFERENT command now occupies a seat (or its label changed), which
// an enablement push cannot express -- SetEnabled only flips a
// boolean on an already-installed id, it cannot swap which id is
// there. A reinstall is the only way to move update.check's seat over
// to update.relaunch, or secrets.lockVault's over to unlockVault.
function seatSignature(): string {
  const update = useUpdateNoticeStore.getState()
  const vault = useVaultStatusStore.getState().vaultStatus
  return `${update.updateNoticeState}|${update.availableVersion}|${vault?.Unlocked ?? ''}|${vault?.Exists ?? ''}`
}

// startNativeMenu installs the menu and keeps it current: enablement
// follows every store that a command's own enabled() can read, the
// state-following seats (goal 0335) reinstall on their own signature
// change, and the tree is rebuilt when the user's keybindings change,
// since a rebound command's item must show (and take) the combo now
// in force.
export function startNativeMenu(): () => void {
  let overrides = useAppStore.getState().keybindingOverrides
  let seats = seatSignature()
  void background(installNativeMenu(), 'menu.installInitial')
  const unsubscribers = [
    useAppStore.subscribe(() => {
      const next = useAppStore.getState().keybindingOverrides
      if (next !== overrides) {
        overrides = next
        void background(installNativeMenu(), 'menu.installOnRebind')
        return
      }
      scheduleEnablementPush()
    }),
    useUISignalStore.subscribe(scheduleEnablementPush),
    useUpdateNoticeStore.subscribe(() => {
      const next = seatSignature()
      if (next !== seats) {
        seats = next
        void background(installNativeMenu(), 'menu.installOnUpdateSeat')
        return
      }
      scheduleEnablementPush()
    }),
    useVaultStatusStore.subscribe(() => {
      const next = seatSignature()
      if (next !== seats) {
        seats = next
        void background(installNativeMenu(), 'menu.installOnVaultSeat')
      }
      // vaultError alone (no Unlocked/Exists change) carries nothing
      // the menu bar renders -- no enablement push needed either.
    }),
    useBuildInfoStore.subscribe(scheduleEnablementPush),
  ]
  return () => {
    if (pending !== undefined) clearTimeout(pending)
    pending = undefined
    for (const off of unsubscribers) off()
  }
}

// The bridge's own model is a discriminated union; Go's is one flat
// record per item, because that is what a bound method's generated
// model can express. This is the one place the two meet.
function toWire(spec: MenuSpec): WireSpec {
  return { Menus: spec.menus.map(wireNode) }
}

function wireNode(node: MenuNode): WireNode {
  return node.kind === 'roleMenu'
    ? { Kind: 'roleMenu', Label: node.label, Role: node.role, Groups: [] }
    : { Kind: 'menu', Label: node.label, Role: '', Groups: node.groups.map((g) => g.map(wireEntry)) }
}

function wireEntry(entry: MenuEntry): WireEntry {
  const base = { Kind: entry.kind, ID: '', Label: '', Accelerator: '', Enabled: false, Role: '', ReleaseAccelerator: false, Groups: [] as WireEntry[][] }
  switch (entry.kind) {
    case 'command':
      return { ...base, ID: entry.id, Label: entry.label, Accelerator: entry.accelerator ?? '', Enabled: entry.enabled }
    case 'role':
      return { ...base, Role: entry.role, ReleaseAccelerator: entry.releaseAccelerator }
    case 'submenu':
      return { ...base, Label: entry.label, Groups: entry.groups.map((g) => g.map(wireEntry)) }
  }
}
