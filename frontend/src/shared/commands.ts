import type { KeyCombo } from './keybinding'
import { useAppStore } from './store'
import type { View } from './store'
import { useUISignalStore } from './uiSignalStore'
import { pluginRegistryCommands } from './pluginHostCommands'
import { lazyArray } from './lazySnapshot'
import { CONFIGURE_CREATE_COMMANDS } from './configureCreateCommands'
import { ATLAS_BOARD_COMMANDS } from './atlasBoardCommands'
import { SETTINGS_COMMANDS } from './settingsCommands'
import { CANVAS_COMMANDS } from './canvasCommands'
import { SAVE_COMMANDS } from './saveCommands'
import { SECRETS_COMMANDS } from './secretsCommands'
import { CLIPBOARD_HISTORY_COMMANDS } from './clipboardHistoryCommands'
import { CODING_LOOP_COMMANDS } from './codingLoopCommands'
import { DOCS_SEARCH_COMMANDS } from './docsSearchCommands'
import { REVIEW_COMMANDS } from './reviewCommands'
import { ATLAS_CREATE_COMMANDS } from './atlasCreateCommands'
import { ATLAS_NAV_COMMANDS } from './atlasNavCommands'
import { HELP_COMMANDS } from './helpCommands'
import { ROW_COMMANDS } from './rowCommands'
import { TAB_COMMANDS } from './tabCommands'
import { withMenuGroup } from './menuGroup'
import type { MenuPlacement } from './menuSpec'
import { pushNotice } from './noticeStore'
import { appTranslate, messageFor } from './userError'
import { copy } from './copy'
import type { CommandContext, CommandContextKind } from './commandContext'
import { contextSatisfies } from './commandContext'

// The command registry (docs/goals/0016-keymap-system.md): named
// commands with a default binding, dispatched by one window keydown
// listener (app/App.tsx) resolving the pressed combo against the
// (possibly user-overridden) binding map. This is the ONLY source of
// truth for the command set + each command's default -- Go's
// SettingsService deliberately never mirrors it (settingsservice_keymap.go's
// own header comment), so a command's label/default lives here, once.
//
// Lives in shared/ (a dependency-cruiser leaf, .claude/rules/frontend.md)
// even though two commands (workflow.save/workflow.run) need to reach
// into whichever CompositionCanvas is the active work tab -- that's
// composition/ code shared/ can't import. Same "different view trees,
// a store field beats a callback chain" shape already established by
// store.ts's own openWorkflowRequest/requestOpenWorkflow seam: those
// two commands set a canvasCommandRequest signal on the store instead,
// which the active CompositionCanvas (composition/CompositionCanvas.tsx)
// watches and consumes. workflow.new needs no such seam -- opening a
// new workflow tab is exactly what store.ts's own openWorkTab already
// does, no composition/ import required either.
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
  // read-only secondary KeyComboChips there and are never looked up in
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
  // Quick Panel opt-in (goal 0222 S2): also renders as a row in the
  // panel's own window (app/quickPanelActionEntries.tsx) -- a run()
  // assuming the MAIN window (setView) is overridden there instead.
  quickPanel?: boolean
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

// commandLabel resolves a command's label key to the string a surface
// shows -- the palette, the Shortcuts overlay, Settings' rebind list,
// the Quick Panel, the menu-bar projection and runCommand's own
// failure notice all go through here rather than reading `label`.
export function commandLabel(command: Pick<Command, 'label'>): string {
  return copy(command.label)
}

function setView(view: View) {
  useAppStore.getState().setView(view)
}

// Exported for app/useKeymapDispatch.ts's own dedicated canvas-command
// listener (undo/redo/zoom), which needs the identical "is there
// actually an open workflow editor tab" gate this file's own
// workflow.save/workflow.run commands already use.
export function isWorkflowEditorTabActive(): boolean {
  const { activeWorkTabKey, workTabs } = useAppStore.getState()
  const active = workTabs.find((t) => t.key === activeWorkTabKey)
  return active?.kind === 'workflow-edit' || active?.kind === 'workflow-new'
}

// workflow.new is usable anywhere in the Workflows area, not only while
// an editor tab happens to be active -- broader than
// isWorkflowEditorTabActive since "start composing" doesn't need a
// canvas already open, just to be looking at Workflows (the pinned list
// tab, or an already-open editor).
function isWorkflowsArea(): boolean {
  return useAppStore.getState().view.kind === 'composition' || isWorkflowEditorTabActive()
}

// LAZY snapshot (shared/lazySnapshot.ts, docs/goals/0249): plugin
// commands are collected during activation, which lands between this
// module's eval and the first read (always render- or event-time).
export const COMMANDS: Command[] = lazyArray(() => [
  ...TAB_COMMANDS,
  {
    id: 'workflow.new',
    menu: { path: 'file', group: 0, order: 0 },
    label: 'commands.workflow.new',
    defaultBinding: { mods: ['cmd'], key: 'N' },
    enabled: isWorkflowsArea,
    run: () => useAppStore.getState().openWorkTab({ kind: 'workflow-new' }),
  },
  {
    id: 'workflow.save',
    menu: { path: 'file', group: 2, order: 0, label: 'menu.items.save' },
    label: 'commands.workflow.save',
    defaultBinding: { mods: ['cmd'], key: 'S' },
    enabled: isWorkflowEditorTabActive,
    run: () => useAppStore.getState().requestCanvasCommand('save'),
  },
  {
    id: 'workflow.run',
    menu: { path: 'workflow', group: 0, order: 0 },
    label: 'commands.workflow.run',
    // ⌘↩ (Cmd+Enter), not ⌘R: ⌘R stays the native browser/dev View > Reload (⌘⇧R too, the developer's own debug escape hatch), so
    // SettingsService.ReleaseMenuAccelerators no longer touches it (settingsservice_menu.go). Cmd+Enter is the editor/chat
    // "run/submit the current thing" convention (Slack send, ChatGPT/Claude submit, IDE "run configuration") and has no
    // RESERVED_COMBOS or native-menu-accelerator collision, checked directly against Wails' own menuitem_roles.go before picking it.
    defaultBinding: { mods: ['cmd'], key: 'Enter' },
    enabled: isWorkflowEditorTabActive,
    run: () => useAppStore.getState().requestCanvasCommand('run'),
  },
  {
    id: 'palette.open',
    menu: { path: 'view', group: 1, order: 0, label: 'menu.items.commandPalette' },
    label: 'commands.palette.open',
    // goal 0015: app/CommandPalette.tsx renders off the store's
    // paletteOpen flag (a plain toggle, not open-only, matching most
    // command-palette conventions -- pressing ⌘K again closes it
    // without needing Escape). shared/ can't import the component
    // itself (dependency-cruiser boundary), so this just flips the
    // shared signal the same way workflow.save/workflow.run already
    // do via canvasCommandRequest.
    defaultBinding: { mods: ['cmd'], key: 'K' },
    // ⌘? / ⌘/ aliases (docs/goals/BACKLOG.md Standing #6, the "owner
    // reinforcement" note CommandPalette.tsx used to document as
    // deliberately not built): both land on the same physical '/' key
    // (keyFromEventCode is shift-independent, shared/keybinding.ts),
    // distinguished by the Shift mod -- ⌘/ is the bare combo, ⌘? adds
    // Shift (what actually produces the '?' glyph). Checked against
    // every other command's defaultBinding above and RESERVED_COMBOS
    // (shared/keybinding.ts): neither uses the '/' key on macOS, no
    // collision.
    // ⌘⇧/ (the ⌘? glyph) moved off this command onto help.shortcuts
    // below (goal 0071) -- ⌘/ stays the palette's own alias.
    extraBindings: [{ mods: ['cmd'], key: '/' }],
    run: () => useAppStore.getState().togglePalette(),
  },
  {
    // The shortcuts-help overlay (goal 0071): bare `?` is handled by a
    // dedicated window listener in app/App.tsx (comboFromEvent requires
    // Cmd/Ctrl by design, so it can never dispatch a bare key) --
    // ⌘⇧/ is this command's own registry-dispatched alias, the same
    // macOS Help-menu convention `?` itself follows.
    id: 'help.shortcuts',
    menu: { path: 'help', group: 0, order: 1, label: 'menu.items.keyboardShortcuts' },
    label: 'commands.help.shortcuts',
    defaultBinding: null,
    extraBindings: [{ mods: ['cmd', 'shift'], key: '/' }],
    run: () => useUISignalStore.getState().openHelp(),
  },
  {
    id: 'view.home',
    menu: { path: 'view', group: 0, order: 0, label: 'menu.items.home' },
    label: 'commands.view.home',
    defaultBinding: { mods: ['cmd'], key: '0' },
    run: () => setView({ kind: 'home' }),
  },
  {
    id: 'view.composition',
    menu: { path: 'view', group: 0, order: 1, label: 'menu.items.workflows' },
    label: 'commands.view.composition',
    defaultBinding: { mods: ['cmd'], key: '1' },
    run: () => setView({ kind: 'composition' }),
  },
  {
    id: 'view.configure',
    menu: { path: 'view', group: 0, order: 2, label: 'menu.items.configure' },
    label: 'commands.view.configure',
    defaultBinding: { mods: ['cmd'], key: '2' },
    run: () => setView({ kind: 'configure' }),
  },
  {
    // Finder's own "Enclosing folder" convention (⌘↑) applied to the
    // Atlas depth ladder: one step up from the focused place. The
    // navigation itself lives in AtlasView (it owns viewedID) --
    // same store-signal seam canvasCommandRequest documents above.
    id: 'atlas.up',
    menu: { path: 'atlas', group: 0, order: 0 },
    label: 'commands.atlas.up',
    defaultBinding: { mods: ['cmd'], key: 'ArrowUp' },
    surface: ['atlas'],
    run: () => useAppStore.getState().requestAtlasUp(),
  },
  {
    // ⌘K reconciliation (goal 0071): atlas.jump and palette.open now
    // share the SAME default combo, legal because the keydown
    // dispatcher's two-pass surface precedence (shared/commandDispatch.ts)
    // always tries every
    // atlas-surfaced command before any surface-less global -- ⌘K opens
    // the jump dialog while on Atlas, the palette everywhere else.
    // AtlasJumpDialog itself is now purely controlled off this signal
    // (its own former capture-phase window listener is retired).
    id: 'atlas.jump',
    menu: { path: 'atlas', group: 0, order: 1 },
    label: 'commands.atlas.jump',
    defaultBinding: { mods: ['cmd'], key: 'K' },
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasJump(),
  },
  // atlas.create.<id> (bare C/N/A/T/I/P/E/L/S) -- own file, atlasCreateCommands.ts, same reason every other feature-specific cluster below already is.
  ...withMenuGroup('atlas', 2, ATLAS_CREATE_COMMANDS),
  ...ATLAS_NAV_COMMANDS,
  // The rest of the Atlas toolbar/board's own commands -- split out to
  // shared/atlasBoardCommands.ts (CLAUDE.md's 500-line convention).
  ...withMenuGroup('atlas', 1, ATLAS_BOARD_COMMANDS),
  {
    // ⌘0..⌘5 mirror the sidebar's own top-to-bottom order -- Atlas
    // sits between Configure and Activity there, so it takes ⌘3 and
    // the two below shift down one.
    id: 'view.atlas',
    menu: { path: 'view', group: 0, order: 3, label: 'menu.items.atlas' },
    label: 'commands.view.atlas',
    defaultBinding: { mods: ['cmd'], key: '3' },
    run: () => setView({ kind: 'atlas' }),
  },
  {
    id: 'view.activity',
    menu: { path: 'view', group: 0, order: 4, label: 'menu.items.activity' },
    label: 'commands.view.activity',
    defaultBinding: { mods: ['cmd'], key: '4' },
    run: () => setView({ kind: 'activity' }),
  },
  {
    id: 'view.review',
    menu: { path: 'view', group: 0, order: 5, label: 'menu.items.review' },
    label: 'commands.view.review',
    defaultBinding: { mods: ['cmd'], key: '5' },
    // Quick Panel's "Review" row reuses this id (its pending-count badge
    // is panel-local presentation, quickPanelActionEntries.tsx).
    quickPanel: true,
    run: () => setView({ kind: 'review' }),
  },
  {
    id: 'view.secrets',
    menu: { path: 'view', group: 0, order: 7, label: 'menu.items.secrets' },
    label: 'commands.view.secrets',
    defaultBinding: { mods: ['cmd'], key: '6' },
    run: () => setView({ kind: 'secrets' }),
  },
  {
    // Docs is deliberately absent from the sidebar (a help surface is
    // reachable on demand, never a standing tab) -- the palette and the
    // footer link are its entry points.
    id: 'view.docs',
    menu: { path: 'view', group: 0, order: 8, label: 'menu.items.docs' },
    label: 'commands.view.docs',
    defaultBinding: null,
    run: () => setView({ kind: 'docs' }),
  },
  // review.rules -- split out to shared/reviewCommands.ts.
  ...REVIEW_COMMANDS,
  // settings.open moved to shared/settingsCommands.ts (goal 0222 S2),
  // alongside its own SettingsService import.
  // Per-Configure-tab create commands (goal 0071 G6) -- split out to
  // shared/configureCreateCommands.ts (CLAUDE.md's 500-line convention);
  // see that file's own header for what each one does and why
  // Attributes has none. Seated as one band in File > New… (goal 0335),
  // in the file's own declared order.
  ...withMenuGroup('file.new', 0, CONFIGURE_CREATE_COMMANDS),
  // panel.applyClipboard, backup.now/export, and the per-Settings-
  // section deep links -- split out to shared/settingsCommands.ts
  // (CLAUDE.md's 500-line convention).
  ...SETTINGS_COMMANDS,
  // Canvas undo/redo/delete/zoom -- split out to shared/canvasCommands.ts
  // (CLAUDE.md's 500-line convention); see that file's own header for
  // why every entry is hintOnly.
  ...withMenuGroup('workflow', 2, CANVAS_COMMANDS),
  // edit.save / edit.saveAll over the flush registry (goal 0295 S2b) --
  // split out to shared/saveCommands.ts.
  ...withMenuGroup('workflow', 1, SAVE_COMMANDS),
  // Vault lock/unlock -- split out to shared/secretsCommands.ts.
  ...SECRETS_COMMANDS,
  // clipboard.history.open -- split out to shared/clipboardHistoryCommands.ts.
  ...CLIPBOARD_HISTORY_COMMANDS,
  // codingLoop.run -- split out to shared/codingLoopCommands.ts.
  ...CODING_LOOP_COMMANDS,
  // docs.search -- split out to shared/docsSearchCommands.ts.
  ...withMenuGroup('help', 0, DOCS_SEARCH_COMMANDS),
  ...HELP_COMMANDS,
  // Commands that act on a target the invoker supplies (goal 0343) --
  // shared/rowCommands.ts. None has a menu seat: a menu bar has no row
  // to point at, and each declares `needs`, so the palette offers one
  // only when ambientContext() resolves that kind.
  ...ROW_COMMANDS,
  // Every plugin-related command (docs/goals/0249, goal 0321) -- what
  // plugins contributed plus the host's own per-plugin actions.
  ...pluginRegistryCommands(),
])

export function findCommand(id: string): Command | undefined {
  return COMMANDS.find((c) => c.id === id)
}

// commandAvailable is the ONE availability test every surface shares
// (goal 0343): the palette, each context/kebab menu, the keymap
// dispatcher and runCommand itself. A command whose `needs` the given
// context doesn't satisfy is unavailable exactly like a failing
// enabled() -- and unavailable means ABSENT everywhere, never dimmed.
export function commandAvailable(command: Command, ctx?: CommandContext): boolean {
  if (!contextSatisfies(command.needs, ctx)) return false
  return !command.enabled || command.enabled(ctx)
}

// runCommand is the ONE door every invoker (palette, menu, keymap,
// notice pill, a plain button) calls instead of a bare run() (goal
// 0313, the `.catch(console.error)` class: a rejected run() used to
// vanish into the console while the surface that fired it looked like
// it did nothing). Unknown id or a failing enabled() both resolve
// false with no notice -- neither is a user-visible failure, just
// nothing to do. A thrown/rejected run() posts one error notice
// (shared/noticeStore.ts's footer pill) naming the command and the
// error, and resolves false. Bare command.run() is legal ONLY inside
// this function -- shared/commandDispatch.ts's own tryRun routes
// through here rather than calling run() itself.
export async function runCommand(id: string, ctx?: CommandContext): Promise<boolean> {
  const command = findCommand(id)
  if (!command) return false
  if (!commandAvailable(command, ctx)) return false
  try {
    await command.run(ctx)
    return true
  } catch (err) {
    pushNotice({
      level: 'error',
      // The command's own label names it, then the ONE sentence the
      // failure carries (shared/userError.ts) -- never the rejection's
      // own message, which for a bound-method call is the Go error
      // chain, and never the command id, which is internal vocabulary.
      text: `${commandLabel(command)}: ${messageFor(err, appTranslate)}`,
    })
    return false
  }
}

// A command's EFFECTIVE binding: its settings-store override if one
// exists, else its own default. The one place this merge happens --
// both the keydown dispatcher (shared/commandDispatch.ts) and the
// Settings UI (KeyboardShortcutsSection) call this rather than each
// re-deriving it.
export function effectiveBinding(command: Command, overrides: Record<string, KeyCombo>): KeyCombo | null {
  return overrides[command.id] ?? command.defaultBinding
}

// Whether two commands' surface scopes could ever collide (goal 0071's
// Settings rebind conflict rule): surface-less counts as intersecting
// EVERY surface, since a global command dispatches on every view,
// including whichever specific one(s) the other command is scoped to.
// Two commands scoped to different, disjoint surfaces never collide --
// they can never both be the active view at once, so sharing a combo
// between them is legal (shared/commandDispatch.ts's own two-pass
// surface precedence is what makes that legal at dispatch time too).
export function surfacesIntersect(a: View['kind'][] | undefined, b: View['kind'][] | undefined): boolean {
  if (!a || !b) return true
  return a.some((kind) => b.includes(kind))
}
