import { useState } from 'react'
import type { TFunction } from 'i18next'
import type { BoardObject, Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { childrenOf } from './atlasGrouping'
import { ConfirmDialog } from '../shared/ConfirmDialog'

// The container-delete gate (docs/goals/0149 gap 3): a delete whose
// blast radius PROMOTES children -- items inside the deleted card
// that survive by moving up a level -- confirms first, naming that
// count; a leaf delete stays instant-with-undo (goal 0093's guard,
// unchanged). Promotion only counts children NOT themselves in the
// selection: deleting a frame together with everything inside it
// promotes nothing.
export function useAtlasDeleteConfirm({ t, allCards, notes, allObjects }: {
  t: TFunction<'atlas'>
  allCards: Card[]
  notes: Note[]
  allObjects: BoardObject[]
}) {
  const [pending, setPending] = useState<{ count: number; promoted: number; exec: () => void } | null>(null)

  // objectIDs (goal 0179/0180) counts toward the confirm dialog's own
  // "Delete N items?" total; a board object can never CONTAIN
  // anything, but a deleted card's FILED objects promote up a level
  // like any child (goals 0233/0266), so they count toward the
  // promoted total too.
  const guardDelete = (cardIDs: string[], noteIDs: string[], exec: () => void, objectIDs: string[] = []) => {
    const selectedCards = new Set(cardIDs)
    const selectedNotes = new Set(noteIDs)
    const selectedObjects = new Set(objectIDs)
    let promoted = 0
    for (const id of cardIDs) {
      promoted += childrenOf(allCards, id).filter((c) => !selectedCards.has(c.ID)).length
      promoted += notes.filter((n) => n.ParentID === id && !selectedNotes.has(n.ID)).length
      promoted += allObjects.filter((o) => o.ParentID === id && !selectedObjects.has(o.ID)).length
    }
    if (promoted === 0) {
      exec()
      return
    }
    setPending({ count: cardIDs.length + noteIDs.length + objectIDs.length, promoted, exec })
  }

  const deleteConfirmDialog = pending && (
    <ConfirmDialog
      title={t('confirm.deletePromoteTitle', { count: pending.count })}
      body={t('confirm.deletePromoteBody', { count: pending.promoted })}
      confirmLabel={t('confirm.deletePromoteConfirm')}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        const exec = pending.exec
        setPending(null)
        exec()
      }}
    />
  )

  return { guardDelete, deleteConfirmDialog }
}
