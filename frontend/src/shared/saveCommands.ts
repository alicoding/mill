import type { Command } from './commands'
import { isWorkflowEditorTabActive } from './commands'
import { flushAll, flushFocused, pendingFlushCount } from './flushRegistry'

// Save commands over the flush registry (goal 0295 S2b): the atom every
// save button / ⌘S / sheet action renders. Enabled only while something
// is actually unsaved -- the palette omits them otherwise. The
// workflow editor keeps its own workflow.save on the same ⌘S (the two
// are mutually exclusive by enablement: one needs the editor tab
// active, this one needs it not).
const SAVE_BOUND_MS = 1500

export const SAVE_COMMANDS: Command[] = [
  {
    id: 'edit.save',
    label: 'Save',
    keywords: ['save'],
    defaultBinding: { mods: ['cmd'], key: 'S' },
    enabled: () => !isWorkflowEditorTabActive() && pendingFlushCount() > 0,
    run: () => { void flushFocused(SAVE_BOUND_MS) },
  },
  {
    id: 'edit.saveAll',
    label: 'Save all changes',
    keywords: ['save all', 'unsaved'],
    defaultBinding: null,
    enabled: () => pendingFlushCount() > 0,
    run: () => { void flushAll(SAVE_BOUND_MS) },
  },
]
