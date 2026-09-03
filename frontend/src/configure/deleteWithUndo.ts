import i18next from 'i18next'
import { ConfigureService } from '../shared/bindings'
import { useUndoDeleteStore } from '../shared/undoDeleteStore'

// deleteWithUndo (goal 0270): delete now, offer the way back. remove is
// the family's own delete RPC -- its reference-integrity refusal
// reaches onError exactly as the confirm-first path's did; a successful
// delete refetches and posts the undo toast, whose Undo restores
// through ConfigureService.UndoDelete and refetches again. entity is
// the family's data-event name ("list", "request", ...).
export async function deleteWithUndo({ entity, id, label, remove, refetch, onError }: {
  entity: string
  id: string
  label: string
  remove: () => Promise<unknown>
  refetch: () => void
  onError?: (err: unknown) => void
}): Promise<void> {
  try {
    await remove()
  } catch (err) {
    onError?.(err)
    return
  }
  refetch()
  useUndoDeleteStore.getState().show({
    key: `${entity}/${id}`,
    message: i18next.t('undoDelete.deleted', { ns: 'common', label }),
    undo: async () => {
      try {
        await ConfigureService.UndoDelete(entity, id)
      } catch (err) {
        onError?.(err)
        return
      }
      refetch()
    },
  })
}
