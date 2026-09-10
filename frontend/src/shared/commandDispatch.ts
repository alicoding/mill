import type { KeyCombo } from './keybinding'
import { comboFromEvent, comboKey } from './keybinding'
import { COMMANDS, commandAvailable, effectiveBinding, runCommand, type Command } from './commands'
import { ambientContext } from './ambientContext'
import { isMenuOwnedCombo } from './menuOwnership'
import { useAppStore, type View } from './store'

// The window keydown -> command resolution, split out of
// shared/commands.ts at the 500-line convention (CLAUDE.md) along the
// registry/dispatch seam: shared/commands.ts owns what a command IS
// and the one door that runs it; this owns how a keystroke finds one.

// dispatchCommandForEvent resolves a keydown against every command's
// current effective binding (its primary, override-aware) PLUS every
// extraBindings entry (docs/goals/BACKLOG.md Standing #6 -- always-on,
// never override-checked, see Command.extraBindings' own doc comment)
// and runs the first match -- called from App.tsx's one window keydown
// listener, folding in what used to be a separate, hardcoded Cmd+1-4/
// Cmd+, handler (view.*/settings.open are now just ordinary commands
// in COMMANDS above, same dispatch path). Returns whether a command
// actually ran, so the caller knows whether to preventDefault (never
// swallow an unbound combo -- native editing shortcuts, browser
// devtools, etc. must keep working).
//
// Two passes, not one array scan (goal 0071's registry surface-
// precedence): every command scoped to the ACTIVE surface is tried
// first, then every surface-less global. This is what makes the same
// combo legal on two different commands as long as at most one of them
// is surface-less (surfacesIntersect's own rule) -- atlas.jump and
// palette.open both default to ⌘K, and the surface pass always wins on
// Atlas, the global pass everywhere else, regardless of which order
// they happen to appear in COMMANDS. A command scoped to a DIFFERENT
// surface than the active one is skipped in both passes -- it cannot
// run there.
export interface CommandComboResolution {
  command: Command
  context: ReturnType<typeof ambientContext>
}

// resolveCommandForCombo is the one keybinding ownership decision used
// by both the main-window listener and a plugin frame's narrow palette
// adapter. It never runs a command: callers decide what result they are
// allowed to act on after this current-state check.
export function resolveCommandForCombo(
  pressed: KeyCombo,
  overrides: Record<string, KeyCombo>,
  activeKind: View['kind'] = useAppStore.getState().view.kind,
  ctx: ReturnType<typeof ambientContext> = ambientContext(),
): CommandComboResolution | undefined {
  const want = comboKey(pressed.mods, pressed.key)
  // The native menu bar owns this combo and already had first refusal
  // on the keypress (shared/menuOwnership.ts) -- reaching here at all
  // means the menu declined it (its item is disabled), so acting on it
  // now would run a command the menu just refused.
  if (isMenuOwnedCombo(want)) return undefined

  const matches = (command: Command): boolean => {
    if (command.hintOnly) return false
    if (!commandAvailable(command, ctx)) return false
    const binding = effectiveBinding(command, overrides)
    const bindings = binding ? [binding, ...(command.extraBindings ?? [])] : (command.extraBindings ?? [])
    return bindings.some((b) => comboKey(b.mods, b.key) === want)
  }

  for (const command of COMMANDS) {
    if (command.surface?.includes(activeKind) && matches(command)) return { command, context: ctx }
  }
  for (const command of COMMANDS) {
    if (!command.surface && matches(command)) return { command, context: ctx }
  }
  return undefined
}

// The frame advertises only bindings that resolve to palette.open NOW.
// This includes the current override and the command's retained aliases,
// while respecting surface precedence and installed native ownership.
export function bindingsResolvingToCommand(
  commandId: string,
  overrides: Record<string, KeyCombo>,
  activeKind: View['kind'] = useAppStore.getState().view.kind,
): KeyCombo[] {
  const command = COMMANDS.find((candidate) => candidate.id === commandId)
  if (!command) return []
  const primary = effectiveBinding(command, overrides)
  const candidates = primary ? [primary, ...(command.extraBindings ?? [])] : (command.extraBindings ?? [])
  const seen = new Set<string>()
  const ctx = ambientContext()
  return candidates.filter((combo) => {
    const key = comboKey(combo.mods, combo.key)
    if (seen.has(key)) return false
    seen.add(key)
    return resolveCommandForCombo(combo, overrides, activeKind, ctx)?.command.id === commandId
  })
}

export function dispatchCommandForEvent(e: KeyboardEvent, overrides: Record<string, KeyCombo>): boolean {
  const pressed = comboFromEvent(e)
  if (!pressed) return false
  const resolved = resolveCommandForCombo(pressed, overrides)
  if (!resolved) return false
  // Fire-and-forget from the dispatcher's own point of view: this
  // function's contract is synchronous (did a binding match, so the
  // caller knows whether to preventDefault), never whether the
  // command's own run() settled -- runCommand still owns catching
  // and reporting that.
  void runCommand(resolved.command.id, resolved.context)
  return true
}
