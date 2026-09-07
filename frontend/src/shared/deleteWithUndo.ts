import i18next from 'i18next'
import { findCommand } from './commands'
import { useUndoDeleteStore } from './undoDeleteStore'

// deleteWithUndo (goal 0270): delete now, offer the way back. remove is
// the family's own delete RPC -- a successful delete refetches and posts
// the undo toast, whose Undo runs the registry's atlas.undo command, so
// the toast pops the SAME journal step ⌘Z would (ADR-0044 amendment:
// the toast is an affordance over the journal, never a second stack;
// goal 0352 part 2). entity is the family's data-event name ("list",
// "request", ...).
//
// A refused delete (reference integrity, a locked store) REJECTS rather
// than reporting here: its only caller is the row-command factory
// (shared/entityRowCommands.ts, goal 0346), and runCommand already names
// the command that failed alongside the one sentence the failure carries.
// The journal apply carries its own skip message (ADR-0044 decision 5),
// so the toast's Undo needs no error channel of its own.
export async function deleteWithUndo({ entity, id, label, remove, refetch }: {
  entity: string
  id: string
  label: string
  remove: () => Promise<unknown>
  refetch: () => void
}): Promise<void> {
  await remove()
  refetch()
  useUndoDeleteStore.getState().show({
    key: `${entity}/${id}`,
    message: i18next.t('undoDelete.deleted', { ns: 'common', label }),
    undo: async () => {
      await findCommand('atlas.undo')?.run()
      refetch()
    },
  })
}
