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
import type { MenuEntry, MenuNode, MenuSpec, MenuSpecContext } from './menuSpec'
import { useAppStore } from './store'
import { useUISignalStore } from './uiSignalStore'
import { useUpdateNoticeStore } from './updateNoticeStore'

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

export function menuContext(): MenuSpecContext {
  const state = useAppStore.getState()
  return { surface: state.view.kind, overrides: state.keybindingOverrides }
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

function enablementVector(ctx: MenuSpecContext): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const command of menuPlaced()) out[command.id] = commandMenuEnabled(command, ctx.surface)
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
  MenuService.SetEnabled(diff).catch(console.error)
}

function scheduleEnablementPush(): void {
  if (pending !== undefined) return
  pending = setTimeout(() => {
    pending = undefined
    pushMenuEnablement()
  }, ENABLEMENT_DEBOUNCE_MS)
}

// startNativeMenu installs the menu and keeps it current: enablement
// follows every store that a command's own enabled() can read, and the
// tree is rebuilt when the user's keybindings change, since a rebound
// command's item must show (and take) the combo now in force.
export function startNativeMenu(): () => void {
  let overrides = useAppStore.getState().keybindingOverrides
  void installNativeMenu().catch(console.error)
  const unsubscribers = [
    useAppStore.subscribe(() => {
      const next = useAppStore.getState().keybindingOverrides
      if (next !== overrides) {
        overrides = next
        void installNativeMenu().catch(console.error)
        return
      }
      scheduleEnablementPush()
    }),
    useUISignalStore.subscribe(scheduleEnablementPush),
    useUpdateNoticeStore.subscribe(scheduleEnablementPush),
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
