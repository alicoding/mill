import { useState } from 'react'
import type { TFunction } from 'i18next'
import type { Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { childrenOf } from './atlasGrouping'
import { ConfirmDialog } from '../shared/ConfirmDialog'

// The container-delete gate (docs/goals/0149 gap 3): a delete whose
// blast radius PROMOTES children -- items inside the deleted card
// that survive by moving up a level -- confirms first, naming that
// count; a leaf delete stays instant-with-undo (goal 0093's guard,
// unchanged). Promotion only counts children NOT themselves in the
// selection: deleting a frame together with everything inside it
// promotes nothing.
export function useAtlasDeleteConfirm({ t, allCards, notes }: {
  t: TFunction<'atlas'>
  allCards: Card[]
  notes: Note[]
}) {
  const [pending, setPending] = useState<{ count: number; promoted: number; exec: () => void } | null>(null)

  const guardDelete = (cardIDs: string[], noteIDs: string[], exec: () => void) => {
    const selectedCards = new Set(cardIDs)
    const selectedNotes = new Set(noteIDs)
    let promoted = 0
    for (const id of cardIDs) {
      promoted += childrenOf(allCards, id).filter((c) => !selectedCards.has(c.ID)).length
      promoted += notes.filter((n) => n.ParentID === id && !selectedNotes.has(n.ID)).length
    }
    if (promoted === 0) {
      exec()
      return
    }
    setPending({ count: cardIDs.length + noteIDs.length, promoted, exec })
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
