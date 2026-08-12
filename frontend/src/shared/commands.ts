import type { KeyCombo } from './keybinding'
import { comboFromEvent, comboKey } from './keybinding'
import { useAppStore } from './store'
import type { View } from './store'

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
  run: () => void
}

function setView(view: View) {
  useAppStore.getState().setView(view)
}

function isWorkflowEditorTabActive(): boolean {
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
    run: () => {
      const { activeWorkTabKey, closeWorkTab } = useAppStore.getState()
      // No active work tab means we're already on the pinned page --
      // "falling back to the pinned tab" (the goal's own last-tab note)
      // is a no-op here, not zero. The window-only-when-none-remain
      // case is native-menu-only (SettingsService.ReleaseMenuAccelerators
      // just lets THIS keypress reach here instead of Cocoa's own Close
      // -- it never hands window-closing back to JS).
      if (!activeWorkTabKey) return
      closeWorkTab(activeWorkTabKey)
    },
  },
  {
    id: 'tab.next',
    label: 'Next tab',
    defaultBinding: { mods: ['ctrl'], key: 'Tab' },
    run: () => cycleWorkTab(1),
  },
  {
    id: 'tab.prev',
    label: 'Previous tab',
    defaultBinding: { mods: ['ctrl', 'shift'], key: 'Tab' },
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
    run: () => {
      const { activeWorkTabKey, closeOtherWorkTabs } = useAppStore.getState()
      // Mirrors WorkTabShell's own overflow-menu item, which disables
      // "Close other tabs" while on the pinned page tab (nothing to
      // keep relative to) -- same no-op here, not an arbitrary target.
      if (!activeWorkTabKey) return
      closeOtherWorkTabs(activeWorkTabKey)
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
    // Deliberately does NOT clear each tab's hot-exit scratch
    // (composition/canvasScratch.ts) -- same precedent tab.close's own
    // ⌘W dispatch above already set: only the mouse-driven close paths
    // (WorkTabShell's ✕ button and overflow-menu items) route through
    // closeAndClearScratch/closeAllTabs's clearScratch wrapping; the
    // keyboard dispatch path calls the store directly, unchanged by
    // this goal.
    run: () => useAppStore.getState().closeAllWorkTabs(),
  },
  {
    id: 'workflow.new',
    label: 'New workflow',
    defaultBinding: { mods: ['cmd'], key: 'N' },
    run: () => {
      if (!isWorkflowsArea()) return
      useAppStore.getState().openWorkTab({ kind: 'workflow-new' })
    },
  },
  {
    id: 'workflow.save',
    label: 'Save workflow',
    defaultBinding: { mods: ['cmd'], key: 'S' },
    run: () => {
      if (!isWorkflowEditorTabActive()) return
      useAppStore.getState().requestCanvasCommand('save')
    },
  },
  {
    id: 'workflow.run',
    label: 'Run workflow',
    // ⌘↩ (Cmd+Enter), not ⌘R -- owner decision: ⌘R stays the native
    // browser/dev View > Reload (⌘⇧R too, the owner's own debug escape
    // hatch), so SettingsService.ReleaseMenuAccelerators no longer
    // touches it (settingsservice_menu.go). Cmd+Enter is the editor/
    // chat "run/submit the current thing" convention (Slack send,
    // ChatGPT/Claude submit, IDE "run configuration") and has no
    // RESERVED_COMBOS or native-menu-accelerator collision, checked
    // directly against Wails' own menuitem_roles.go before picking it.
    defaultBinding: { mods: ['cmd'], key: 'Enter' },
    run: () => {
      if (!isWorkflowEditorTabActive()) return
      useAppStore.getState().requestCanvasCommand('run')
    },
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
    run: () => useAppStore.getState().togglePalette(),
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
    id: 'view.activity',
    label: 'Go to Activity',
    defaultBinding: { mods: ['cmd'], key: '3' },
    run: () => setView({ kind: 'activity' }),
  },
  {
    id: 'view.review',
    label: 'Go to Review',
    defaultBinding: { mods: ['cmd'], key: '4' },
    run: () => setView({ kind: 'review' }),
  },
  {
    id: 'settings.open',
    label: 'Open Settings',
    defaultBinding: { mods: ['cmd'], key: ',' },
    run: () => setView({ kind: 'settings' }),
  },
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

// dispatchCommandForEvent resolves a keydown against every command's
// current effective binding and runs the first match -- called from
// App.tsx's one window keydown listener, folding in what used to be a
// separate, hardcoded Cmd+1-4/Cmd+, handler (view.*/settings.open are
// now just ordinary commands in COMMANDS above, same dispatch path).
// Returns whether a command actually ran, so the caller knows whether
// to preventDefault (never swallow an unbound combo -- native
// editing shortcuts, browser devtools, etc. must keep working).
export function dispatchCommandForEvent(e: KeyboardEvent, overrides: Record<string, KeyCombo>): boolean {
  const pressed = comboFromEvent(e)
  if (!pressed) return false
  const want = comboKey(pressed.mods, pressed.key)
  for (const command of COMMANDS) {
    const binding = effectiveBinding(command, overrides)
    if (!binding) continue
    if (comboKey(binding.mods, binding.key) === want) {
      command.run()
      return true
    }
  }
  return false
}
