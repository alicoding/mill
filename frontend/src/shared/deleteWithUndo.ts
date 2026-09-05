import i18next from 'i18next'
import { ConfigureService } from './bindings'
import { pushNotice } from './noticeStore'
import { useUndoDeleteStore } from './undoDeleteStore'
import { appTranslate, messageFor } from './userError'

// deleteWithUndo (goal 0270): delete now, offer the way back. remove is
// the family's own delete RPC -- a successful delete refetches and posts
// the undo toast, whose Undo restores through ConfigureService.UndoDelete
// and refetches again. entity is the family's data-event name ("list",
// "request", ...).
//
// A refused delete (reference integrity, a locked store) REJECTS rather
// than reporting here: its only caller is the row-command factory
// (shared/entityRowCommands.ts, goal 0346), and runCommand already names
// the command that failed alongside the one sentence the failure carries.
// The undo path has no such frame around it -- the toast fires it long
// after the command resolved -- so a failed restore posts its own notice.
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
      try {
        await ConfigureService.UndoDelete(entity, id)
      } catch (err) {
        pushNotice({ level: 'error', text: messageFor(err, appTranslate) })
        return
      }
      refetch()
    },
  })
}
