import { useState } from 'react'
import type { TFunction } from 'i18next'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { refreshAtlas } from './atlasStore'

// "Turn back into object" (goal 0410 Decision 3): DemoteCard drops the
// card's title, Kind, fields and links, so -- same reversible-in-place
// rule dissolve's own confirm follows (useAtlasContainmentMenus.tsx)
// -- it confirms first, naming exactly what is lost, rather than
// firing straight off the context menu/palette. ⌘Z is the undo
// surface (DemoteCard's own single undo mark); no separate toast, the
// same posture "Promote to card" already takes.
export function useAtlasDemoteConfirm({ t, allCards, onError }: {
  t: TFunction<'atlas'>
  allCards: Card[]
  onError: (message: string) => void
}) {
  const [demoteTarget, setDemoteTarget] = useState<Card | null>(null)

  const demote = (cardID: string) => {
    const card = allCards.find((c) => c.ID === cardID)
    if (card) setDemoteTarget(card)
  }

  const demoteDialog = demoteTarget && (
    <ConfirmDialog
      title={t('confirm.demoteTitle')}
      body={t('confirm.demoteBody')}
      confirmLabel={t('confirm.demoteConfirm')}
      onCancel={() => setDemoteTarget(null)}
      onConfirm={() => {
        const id = demoteTarget.ID
        setDemoteTarget(null)
        AtlasService.DemoteCard(id)
          .then(() => void refreshAtlas())
          .catch((err) => onError(String(err)))
      }}
    />
  )

  return { demote, demoteDialog }
}
