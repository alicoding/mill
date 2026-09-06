import type { Command } from './commands'
import { tabContext } from './commandContext'
import { useAppStore } from './store'

// The work-tab family (docs/goals/0016-keymap-system.md, goal 0018's
// browser-tab affordances) -- split out of shared/commands.ts
// (CLAUDE.md's 500-line convention), spread into its COMMANDS array,
// where its File-menu and View-menu seats are decided.

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


export const TAB_COMMANDS: Command[] = [
  {
    id: 'tab.close',
    menu: { path: 'file', group: 1, order: 0 },
    label: 'commands.tab.close',
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
    menu: { path: 'view', group: 2, order: 0 },
    label: 'commands.tab.next',
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
    menu: { path: 'view', group: 2, order: 1 },
    label: 'commands.tab.prev',
    defaultBinding: { mods: ['ctrl', 'shift'], key: 'Tab' },
    // ⌘⇧[ -- same browser convention as tab.next's ⌘⇧] above.
    extraBindings: [{ mods: ['cmd', 'shift'], key: '[' }],
    run: () => cycleWorkTab(-1),
  },
  {
    id: 'tab.closeOthers',
    menu: { path: 'file', group: 1, order: 1 },
    label: 'commands.tab.closeOthers',
    // Safari's own convention for the identical action (Option+Cmd+W is
    // literally "Close Other Tabs" there) -- picked over an arbitrary
    // combo since Mill's tab strip already models the same browser-tab
    // affordances (goal 0018). Checked against RESERVED_COMBOS
    // (shared/keybinding.ts, none of which use W) and every other
    // command's default above: no collision.
    defaultBinding: { mods: ['cmd', 'option'], key: 'W' },
    // Nothing to keep relative to on the pinned page tab.
    enabled: (ctx) => Boolean(tabContext(ctx)) || useAppStore.getState().activeWorkTabKey !== null,
    run: (ctx) => {
      const { activeWorkTabKey, requestWorkTabClose } = useAppStore.getState()
      const keepKey = tabContext(ctx)?.key ?? activeWorkTabKey
      if (!keepKey) return
      requestWorkTabClose({ kind: 'others', keepKey })
    },
  },
  {
    id: 'tab.closeAll',
    menu: { path: 'file', group: 1, order: 2 },
    label: 'commands.tab.closeAll',
    // Safari's "Close Window" combo (Shift+Cmd+W) repurposed the same
    // way tab.close above already repurposed plain Cmd+W -- Mill has no
    // multi-window tab groups, so "close every open work tab" is the
    // closest real equivalent action in this app.
    defaultBinding: { mods: ['cmd', 'shift'], key: 'W' },
    run: () => useAppStore.getState().requestWorkTabClose({ kind: 'all' }),
  },
]
