import type { Command } from './commands'
import { useUISignalStore } from './uiSignalStore'

// clipboard.history.open (goal 0234): always enabled (the dialog itself
// renders its own empty state when the seeded workflow hasn't been
// turned on yet) -- split out of shared/commands.ts (CLAUDE.md's
// 500-line convention), same shape as secretsCommands.ts. No default
// binding: discoverable via the palette and freely keyboard-assignable
// in Settings > Keyboard Shortcuts (Command.defaultBinding's own
// null-means-unbound convention, same as help.shortcuts/view.docs).
export const CLIPBOARD_HISTORY_COMMANDS: Command[] = [
  {
    id: 'clipboard.history.open',
    menu: { path: 'view', group: 3, order: 0 },
    label: 'commands.clipboard.history.open',
    defaultBinding: null,
    run: () => useUISignalStore.getState().openClipboardHistory(),
  },
]
