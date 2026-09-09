import { copy } from './copy'
import { findCommand } from './commands'
import { useUndoDeleteStore } from './undoDeleteStore'

// The "Moved to Trash" toast (goal 0406 S2): posted after every
// successful Secrets delete, row menu or detail-panel alike (both call
// this ONE function so the two entry points can never drift). Its
// action is "Show Trash," not "Undo" -- the Trash itself is the way
// back for 30 days, so this toast only navigates there, through the
// same secret.showTrash command the palette/keyboard would run.
export function postMovedToTrashToast(id: string): void {
  useUndoDeleteStore.getState().show({
    key: `secret/${id}`,
    message: copy('secrets:trash.movedToast'),
    actionLabel: copy('secrets:trash.showTrashAction'),
    undo: async () => { await findCommand('secret.showTrash')?.run() },
  })
}
