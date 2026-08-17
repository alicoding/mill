import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { titleFromFilename } from './atlasCreateHelpers'
import { freeChildPosition } from './atlasContainmentPlacement'
import { useAtlasFolderImportRequestStore } from './atlasFolderImportRequest'
import { FILE_DROP_EVENT_NAME, FILE_DROP_CONTEXT_CARD_PAGE } from './atlasFileDropShared'

// The card-foremost half of the native OS file-drop door (D5, LOCKED
// design): while a card's page is open, a dropped file becomes a
// LINKED SIBLING -- same parent as the open card, plus a link from it
// -- created atomically server-side (atlassvc.CreateLinkedFileCard).
// The open card is NEVER mutated; onSaved's own dataevent-driven
// refresh is what makes the new link show up in the page's links
// section. A multi-file/directory drop while the page is open routes
// into the same prescoped folder-import preview the board uses,
// scoped to the open card's own parent (extrapolated from the LOCKED
// design's board-context rule -- not spelled out for this context).
// A read failure reuses the page's own existing error slot (onError)
// rather than a second transient toast.
export function useAtlasCardPageFileDrop({ card, allCards, onSaved, onError }: {
  card: Card
  allCards: Card[]
  onSaved: () => void
  onError: (message: string) => void
}) {
  const { t } = useTranslation('atlas')
  const requestFolderImport = useAtlasFolderImportRequestStore((s) => s.requestFolderImport)

  const stateRef = useRef({ card, allCards, onSaved, onError, requestFolderImport })
  useEffect(() => {
    stateRef.current = { card, allCards, onSaved, onError, requestFolderImport }
  }, [card, allCards, onSaved, onError, requestFolderImport])

  useEffect(() => {
    return Events.On(FILE_DROP_EVENT_NAME, (evt) => {
      const payload = evt.data as { filenames?: string[]; context?: string } | undefined
      if (!payload || payload.context !== FILE_DROP_CONTEXT_CARD_PAGE || !payload.filenames?.length) return
      const { card: openCard, allCards: cards, onSaved: saved, onError: fail, requestFolderImport: request } = stateRef.current

      AtlasService.ResolveFileDropRoute(payload.filenames)
        .then((route) => {
          if (route.Kind === 'import') {
            request(route.Path, openCard.ParentID)
            return
          }
          const path = route.Path
          const position = openCard.ParentID ? freeChildPosition(cards, openCard.ParentID) : null
          return AtlasService.CreateLinkedFileCard(openCard.ID, path, titleFromFilename(path), position).then(() => saved())
        })
        .catch(() => fail(t('capture.dropError')))
    })
  }, [t])
}
