import type { KeyCombo } from './keybinding'
import { comboFromEvent, comboKey } from './keybinding'
import { useAppStore } from './store'
import type { View } from './store'
import { useUISignalStore } from './uiSignalStore'
import { drainedPluginCommands } from '../plugins/pluginCommands'
import { CONFIGURE_CREATE_COMMANDS } from './configureCreateCommands'
import { ATLAS_BOARD_COMMANDS } from './atlasBoardCommands'
import { SETTINGS_COMMANDS } from './settingsCommands'
import { CANVAS_COMMANDS } from './canvasCommands'
import { SECRETS_COMMANDS } from './secretsCommands'
import { CLIPBOARD_HISTORY_COMMANDS } from './clipboardHistoryCommands'
import { CODING_LOOP_COMMANDS } from './codingLoopCommands'
import { DOCS_SEARCH_COMMANDS } from './docsSearchCommands'
import { REVIEW_COMMANDS } from './reviewCommands'
import { ATLAS_CREATE_COMMANDS } from './atlasCreateCommands'

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
  // keybindingOverrides by dispatchCommandForEvent below -- a real
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
  // Shortcuts Help overlay; dispatchCommandForEvent below skips it, and
  // KeyboardShortcutsSection excludes it from the rebind list.
  hintOnly?: boolean
  // Excludes this command from the palette (app/CommandPalette.tsx) --
  // for an action needing a live, on-screen selection/target the
  // palette has no way to supply. Still reachable via HotkeyHint,
  // ContextMenu items, and the Shortcuts Help overlay.
  paletteHidden?: boolean
  // State-aware enablement (goal 0222 S1, VSCode's "when" clause): omit
  // for an always-valid command. Replaces guarding inline inside run()
  // and returning silently. CommandPalette.tsx omits a disabled command
  // entirely (unavailable means absent, not dimmed); dispatchCommandForEvent
  // below skips its binding -- run() stays free of the check.
  enabled?: () => boolean
  // Quick Panel opt-in (goal 0222 S2): also renders as a row in the
  // panel's own window (app/quickPanelActionEntries.tsx) -- a run()
  // assuming the MAIN window (setView) is overridden there instead.
  quickPanel?: boolean
  run: () => void
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

// tab.next/tab.prev cycle a ring of [pinned page tab, ...workTabs] --
// the same set the tab strip itself renders (app/WorkTabShell.tsx),
// with `null` standing in for the pinned page tab's own activeWorkTabKey
// value. A no-op when no work tabs are open (nothing to cycle to).
function cycleWorkTab(direction: 1 | -1): void {
  const { workTabs, activeWorkTabKey, activateWorkTab } = useAppStore.getState()
  if (workTabs.length === 0) return
  const keys: (string | null)[] = [null, ...workTabs.map((t) => t.key)]
  const from = keys.indexOf(activeWorkTabKey)
  const next = ((from === -1 ? 0 : from) + direction + keys.length) % keys.length
  activateWorkTab(keys[next])
}

export const COMMANDS: Command[] = [
  {
    id: 'tab.close',
    label: 'Close tab',
    defaultBinding: { mods: ['cmd'], key: 'W' },
    // No active work tab means we're already on the pinned page --
    // nothing to close (the window-only-when-none-remain case is
    // native-menu-only, SettingsService.ReleaseMenuAccelerators).
    enabled: () => useAppStore.getState().activeWorkTabKey !== null,
    run: () => {
      const { activeWorkTabKey, requestWorkTabClose } = useAppStore.getState()
      if (!activeWorkTabKey) return
      // Routes through the close-guard signal (docs/goals/0048) rather
      // than calling closeWorkTab directly -- app/useWorkTabCloseGuard.ts
      // decides whether the tab is dirty and prompts before it closes.
      requestWorkTabClose({ kind: 'one', key: activeWorkTabKey })
    },
  },
  {
    id: 'tab.next',
    label: 'Next tab',
    defaultBinding: { mods: ['ctrl'], key: 'Tab' },
    // ⌘⇧] -- the browser convention (Safari/Chrome "Show Next Tab")
    // for the identical action, alongside Ctrl+Tab the same way
    // palette.open carries its ⌘//⌘? aliases. Checked against
    // RESERVED_COMBOS (shared/keybinding.ts), every other command's
    // bindings here, and the native menu (no bracket accelerators):
    // no collision.
    extraBindings: [{ mods: ['cmd', 'shift'], key: ']' }],
    run: () => cycleWorkTab(1),
  },
  {
    id: 'tab.prev',
    label: 'Previous tab',
    defaultBinding: { mods: ['ctrl', 'shift'], key: 'Tab' },
    // ⌘⇧[ -- same browser convention as tab.next's ⌘⇧] above.
    extraBindings: [{ mods: ['cmd', 'shift'], key: '[' }],
    run: () => cycleWorkTab(-1),
  },
  {
    id: 'tab.closeOthers',
    label: 'Close other tabs',
    // Safari's own convention for the identical action (Option+Cmd+W is
    // literally "Close Other Tabs" there) -- picked over an arbitrary
    // combo since Mill's tab strip already models the same browser-tab
    // affordances (goal 0018). Checked against RESERVED_COMBOS
    // (shared/keybinding.ts, none of which use W) and every other
    // command's default above: no collision.
    defaultBinding: { mods: ['cmd', 'option'], key: 'W' },
    // Nothing to keep relative to on the pinned page tab.
    enabled: () => useAppStore.getState().activeWorkTabKey !== null,
    run: () => {
      const { activeWorkTabKey, requestWorkTabClose } = useAppStore.getState()
      if (!activeWorkTabKey) return
      requestWorkTabClose({ kind: 'others', keepKey: activeWorkTabKey })
    },
  },
  {
    id: 'tab.closeAll',
    label: 'Close all tabs',
    // Safari's "Close Window" combo (Shift+Cmd+W) repurposed the same
    // way tab.close above already repurposed plain Cmd+W -- Mill has no
    // multi-window tab groups, so "close every open work tab" is the
    // closest real equivalent action in this app.
    defaultBinding: { mods: ['cmd', 'shift'], key: 'W' },
    run: () => useAppStore.getState().requestWorkTabClose({ kind: 'all' }),
  },
  {
    id: 'workflow.new',
    label: 'New workflow',
    defaultBinding: { mods: ['cmd'], key: 'N' },
    enabled: isWorkflowsArea,
    run: () => useAppStore.getState().openWorkTab({ kind: 'workflow-new' }),
  },
  {
    id: 'workflow.save',
    label: 'Save workflow',
    defaultBinding: { mods: ['cmd'], key: 'S' },
    enabled: isWorkflowEditorTabActive,
    run: () => useAppStore.getState().requestCanvasCommand('save'),
  },
  {
    id: 'workflow.run',
    label: 'Run workflow',
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
    label: 'Open command palette',
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
    label: 'Keyboard shortcuts help',
    defaultBinding: null,
    extraBindings: [{ mods: ['cmd', 'shift'], key: '/' }],
    run: () => useUISignalStore.getState().openHelp(),
  },
  {
    id: 'view.home',
    label: 'Go to Home',
    defaultBinding: { mods: ['cmd'], key: '0' },
    run: () => setView({ kind: 'home' }),
  },
  {
    id: 'view.composition',
    label: 'Go to Workflows',
    defaultBinding: { mods: ['cmd'], key: '1' },
    run: () => setView({ kind: 'composition' }),
  },
  {
    id: 'view.configure',
    label: 'Go to Configure',
    defaultBinding: { mods: ['cmd'], key: '2' },
    run: () => setView({ kind: 'configure' }),
  },
  {
    // Finder's own "Enclosing folder" convention (⌘↑) applied to the
    // Atlas depth ladder: one step up from the focused place. The
    // navigation itself lives in AtlasView (it owns viewedID) --
    // same store-signal seam canvasCommandRequest documents above.
    id: 'atlas.up',
    label: 'Go up one level',
    defaultBinding: { mods: ['cmd'], key: 'ArrowUp' },
    surface: ['atlas'],
    run: () => useAppStore.getState().requestAtlasUp(),
  },
  {
    // ⌘K reconciliation (goal 0071): atlas.jump and palette.open now
    // share the SAME default combo, legal because dispatchCommandForEvent's
    // two-pass surface precedence (below) always tries every
    // atlas-surfaced command before any surface-less global -- ⌘K opens
    // the jump dialog while on Atlas, the palette everywhere else.
    // AtlasJumpDialog itself is now purely controlled off this signal
    // (its own former capture-phase window listener is retired).
    id: 'atlas.jump',
    label: 'Jump to a card',
    defaultBinding: { mods: ['cmd'], key: 'K' },
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasJump(),
  },
  // atlas.create.<id> (bare C/N/A/T/I/P/E/L/S) -- own file, atlasCreateCommands.ts, same reason every other feature-specific cluster below already is.
  ...ATLAS_CREATE_COMMANDS,
  // The board's ⌘Z/⇧⌘Z (goal 0219 S2, ADR-0044): null binding -- ⌘Z is
  // ALSO native text-undo, dispatched by useKeymapDispatch.ts's own
  // listener instead; these exist for palette/HotkeyHint discovery only.
  {
    id: 'atlas.undo',
    label: 'Undo',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasUndo(),
  },
  {
    id: 'atlas.redo',
    label: 'Redo',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasRedo(),
  },
  {
    id: 'atlas.matrix',
    label: 'Open traceability matrix',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasMatrixOpen(),
  },
  {
    id: 'atlas.coverage',
    label: 'Open coverage',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasCoverageOpen(),
  },
  {
    id: 'atlas.roadmap',
    label: 'Open roadmap',
    defaultBinding: null,
    surface: ['atlas'],
    run: () => useUISignalStore.getState().requestAtlasRoadmapOpen(),
  },
  // The rest of the Atlas toolbar/board's own commands -- split out to
  // shared/atlasBoardCommands.ts (CLAUDE.md's 500-line convention).
  ...ATLAS_BOARD_COMMANDS,
  {
    // ⌘0..⌘5 mirror the sidebar's own top-to-bottom order -- Atlas
    // sits between Configure and Activity there, so it takes ⌘3 and
    // the two below shift down one.
    id: 'view.atlas',
    label: 'Go to Atlas',
    defaultBinding: { mods: ['cmd'], key: '3' },
    run: () => setView({ kind: 'atlas' }),
  },
  {
    id: 'view.activity',
    label: 'Go to Activity',
    defaultBinding: { mods: ['cmd'], key: '4' },
    run: () => setView({ kind: 'activity' }),
  },
  {
    id: 'view.review',
    label: 'Go to Review',
    defaultBinding: { mods: ['cmd'], key: '5' },
    // Quick Panel's "Review" row reuses this id (its pending-count badge
    // is panel-local presentation, quickPanelActionEntries.tsx).
    quickPanel: true,
    run: () => setView({ kind: 'review' }),
  },
  {
    id: 'view.secrets',
    label: 'Go to Secrets',
    defaultBinding: { mods: ['cmd'], key: '6' },
    run: () => setView({ kind: 'secrets' }),
  },
  {
    // Docs is deliberately absent from the sidebar (a help surface is
    // reachable on demand, never a standing tab) -- the palette and the
    // footer link are its entry points.
    id: 'view.docs',
    label: 'Open docs',
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
  // Attributes has none.
  ...CONFIGURE_CREATE_COMMANDS,
  // panel.applyClipboard, backup.now/export, and the per-Settings-
  // section deep links -- split out to shared/settingsCommands.ts
  // (CLAUDE.md's 500-line convention).
  ...SETTINGS_COMMANDS,
  // Canvas undo/redo/delete/zoom -- split out to shared/canvasCommands.ts
  // (CLAUDE.md's 500-line convention); see that file's own header for
  // why every entry is hintOnly.
  ...CANVAS_COMMANDS,
  // Vault lock/unlock -- split out to shared/secretsCommands.ts.
  ...SECRETS_COMMANDS,
  // clipboard.history.open -- split out to shared/clipboardHistoryCommands.ts.
  ...CLIPBOARD_HISTORY_COMMANDS,
  // codingLoop.run -- split out to shared/codingLoopCommands.ts.
  ...CODING_LOOP_COMMANDS,
  // docs.search -- split out to shared/docsSearchCommands.ts.
  ...DOCS_SEARCH_COMMANDS,
  // Runtime plugin commands (docs/goals/0249): drained from the
  // plugins/pluginCommands.ts collector, which activation filled
  // BEFORE this module evaluated (main.tsx's boot order). Never
  // default-bound -- a plugin command is palette-reachable; a
  // keybinding for third-party code is assigned in Settings, never
  // shipped by the plugin.
  ...drainedPluginCommands().map((c) => ({ id: c.id, label: c.label, defaultBinding: null, run: c.run })),
]

export function findCommand(id: string): Command | undefined {
  return COMMANDS.find((c) => c.id === id)
}

// A command's EFFECTIVE binding: its settings-store override if one
// exists, else its own default. The one place this merge happens --
// both the dispatcher below and the Settings UI (KeyboardShortcutsSection)
// call this rather than each re-deriving it.
export function effectiveBinding(command: Command, overrides: Record<string, KeyCombo>): KeyCombo | null {
  return overrides[command.id] ?? command.defaultBinding
}

// Whether two commands' surface scopes could ever collide (goal 0071's
// Settings rebind conflict rule): surface-less counts as intersecting
// EVERY surface, since a global command dispatches on every view,
// including whichever specific one(s) the other command is scoped to.
// Two commands scoped to different, disjoint surfaces never collide --
// they can never both be the active view at once, so sharing a combo
// between them is legal (dispatchCommandForEvent's own two-pass surface
// precedence below is what makes that legal at dispatch time too).
export function surfacesIntersect(a: View['kind'][] | undefined, b: View['kind'][] | undefined): boolean {
  if (!a || !b) return true
  return a.some((kind) => b.includes(kind))
}

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
export function dispatchCommandForEvent(e: KeyboardEvent, overrides: Record<string, KeyCombo>): boolean {
  const pressed = comboFromEvent(e)
  if (!pressed) return false
  const want = comboKey(pressed.mods, pressed.key)
  const activeKind = useAppStore.getState().view.kind

  const tryRun = (command: Command): boolean => {
    if (command.hintOnly) return false
    if (command.enabled && !command.enabled()) return false
    const binding = effectiveBinding(command, overrides)
    const bindings = binding ? [binding, ...(command.extraBindings ?? [])] : (command.extraBindings ?? [])
    if (!bindings.some((b) => comboKey(b.mods, b.key) === want)) return false
    command.run()
    return true
  }

  for (const command of COMMANDS) {
    if (command.surface?.includes(activeKind) && tryRun(command)) return true
  }
  for (const command of COMMANDS) {
    if (!command.surface && tryRun(command)) return true
  }
  return false
}
