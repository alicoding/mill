import type { KeyCombo } from './keybinding'
import type { View } from './store'
import type { MenuPlacement } from './menuSpec'
import type { CommandContext, CommandContextKind } from './commandContext'

// The Command interface, split out of commands.ts at the 500-line
// convention (CLAUDE.md): the registry's own shape, kept apart from
// COMMANDS's assembly and runCommand/commandAvailable's own logic so
// either half can grow without the other paying its line cost. Every
// existing `import type { Command } from './commands'` site keeps
// working unchanged -- commands.ts re-exports this type.
export interface Command {
  id: string
  // A locale key, not a sentence (goal 0341): this registry is
  // module-scope, so it has no React tree to resolve through and
  // holds the key instead. commandLabel() below is the one resolver
  // every renderer and projection calls. A plugin-contributed command
  // supplies plain author-written English here; copy() returns an
  // unresolvable key verbatim, so both flow through the same call.
  label: string
  // null only for a command that's genuinely never bound by default
  // (none exist yet) -- every command below has one, including
  // palette.open, whose binding is reserved ahead of goal 0015 actually
  // building the palette.
  defaultBinding: KeyCombo | null
  // Additional, always-on bindings for the SAME command (docs/goals/
  // BACKLOG.md Standing #6) -- backward-compatible (every existing
  // command simply omits it). Deliberately NOT user-rebindable this
  // pass: Settings' recorder-based rebinding UI
  // (views/KeyboardShortcutsSection.tsx) edits `defaultBinding` only
  // (via keybindingOverrides, same as before); extras render as
  // read-only secondary hint chips there and are never looked up in
  // keybindingOverrides by the keydown dispatcher (shared/commandDispatch.ts) -- a real
  // "edit an alias" feature (its own override storage keyed by
  // command+index, its own Go-side persistence) is more than this
  // item's scope covers, named as a future extension rather than half-
  // built here.
  extraBindings?: KeyCombo[]
  // Surface-scoped commands (goal 0071's recorded shape): when set,
  // the command only dispatches while the active view's kind is
  // listed, and the palette seats it in its "On this page" section
  // instead of the global Commands group. Globals simply omit it.
  surface?: View['kind'][]
  // Display-only binding: real keydown handling lives in a dedicated
  // listener elsewhere -- either a live selection this registry can't
  // see (Delete/G over the atlas selection tray), or a native browser
  // shortcut the same combo also means inside an editable field
  // (Cmd+A). defaultBinding/extraBindings still drive HotkeyHint/the
  // Shortcuts Help overlay; shared/commandDispatch.ts skips it, and
  // KeyboardShortcutsSection excludes it from the rebind list.
  hintOnly?: boolean
  // Excludes this command from the palette (app/CommandPalette.tsx) --
  // for an action needing a live, on-screen selection/target the
  // palette has no way to supply. Still reachable via HotkeyHint,
  // ContextMenu items, and the Shortcuts Help overlay.
  paletteHidden?: boolean
  // A resolved (not a key) secondary line the palette shows under
  // `label` (goal 0412 S2, e.g. a per-setting deep link's own group
  // breadcrumb: "General"). Resolved, not a key, for the same
  // module-scope reason commandLabel's own `resolveGroupTitle`-style
  // callers already resolve at build time -- this registry has no
  // React tree to call t() from. Omit for a command with no secondary
  // line.
  paletteDescription?: string
  // Search aliases (goal 0295, the launcher convention Raycast calls
  // keywords): a query that starts any keyword ranks the command as a
  // prefix match, ahead of rows that merely contain it -- so "update"
  // finds "Check for updates" above a workflow whose label happens to
  // mention an update. Lowercase, user vocabulary, never ids.
  keywords?: string[]
  // State-aware enablement (goal 0222 S1, VSCode's "when" clause): omit
  // for an always-valid command. Replaces guarding inline inside run()
  // and returning silently. CommandPalette.tsx omits a disabled command
  // entirely (unavailable means absent, not dimmed); the keydown
  // dispatcher (shared/commandDispatch.ts) skips its binding -- run()
  // stays free of the check. Receives
  // the SAME context run() will (goal 0343), so "can this act on that
  // target" is answered once, by the command, for every surface.
  enabled?: (ctx?: CommandContext) => boolean
  // The target kind this command REQUIRES (goal 0343). A command with
  // `needs` and no matching context cannot run: runCommand returns
  // false without running and without a notice (nothing was asked of a
  // target), every menu omits it, and the palette shows it only when
  // ambientContext() happens to resolve that kind. Omit for a command
  // that acts on global state.
  needs?: CommandContextKind
  // A label composed from the target (goal 0346 slice B): "Open
  // <linked card>", "Add card to <frame>". Returns the resolved string
  // for this context, or undefined to fall back to `label`; the
  // palette and the reference page read `label` alone.
  labelFor?: (ctx?: CommandContext) => string | undefined
  // A question the surface asks before run() (goal 0346 slice B): the
  // confirm dialog's own copy, resolved for this target, or null when
  // this target needs no confirmation. The menu/kebab hosts the dialog;
  // runCommand itself never asks.
  confirm?: (ctx?: CommandContext) => { title: string; body: string; confirmLabel?: string } | null
  // Quick Panel opt-in (goal 0222 S2): also renders as a row in the
  // panel's own window (app/quickPanelActionEntries.tsx) -- a run()
  // assuming the MAIN window (setView) is overridden there instead.
  quickPanel?: boolean
  // A bulk action over a live selection (goal 0404 S1): SelectionBar
  // renders every `bulk: true` command scoped to the active surface.
  bulk?: boolean
  // Native menu bar placement (goal 0332): the menu bar is a projection
  // of this registry, so a command that belongs in a menu says so here
  // rather than being listed again somewhere else. Omit and the command
  // simply has no menu item. shared/menuSpec.ts's own doc has the band/
  // order semantics.
  menu?: MenuPlacement
  // A rejection is never the caller's problem to catch -- runCommand
  // below is the one place that awaits and reports it. A synchronous
  // run() (the common case) needs no change to satisfy this;
  // `Promise<unknown>` (not `<void>`) so a run() that returns a bound
  // service call's own result (e.g. `() => BackupService.BackupNow(0)`)
  // needs no `.then(() => {})` wrapper just to fit the shape.
  // ctx is the target the INVOKER supplies (goal 0343) -- a row hands
  // its own row's context, the keymap and palette hand
  // ambientContext(). A command acting on global state ignores the
  // parameter entirely.
  run: (ctx?: CommandContext) => void | Promise<unknown>
}
