import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import { MirrorKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { MirrorContent } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import runbookStyles from '../shared/ListCard.module.css'
import { useAtlasMirrorChanged } from './useAtlasMirrorChanged'
import { AtlasMirrorMissingState } from './AtlasMirrorMissingState'
import { DrawioDiagramHost } from './AtlasUnitDrawioPage'
import type { UnitRenderProps } from './unitRegistry'
import noteStyles from './AtlasNoteCardNode.module.css'

function formatMirrorSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`
  return `${(bytes / (1000 * 1000)).toFixed(1)} MB`
}

// The bare .drawio unit's board face (goal 0410 S1, closing goal 0179
// gap 2's remaining diagram half): a promoted diagram card is
// otherwise an empty titled box until opened, same as the mirror-image
// face already fixed. Reuses DrawioDiagramHost -- the exact same
// vendored-viewer render the card's own Page and the board-object
// diagram face both already use -- through the `interactive` fixed-
// viewport mode so it fills the card's compact face box rather than
// growing to the drawing.
export function AtlasUnitDrawioFace({ card }: UnitRenderProps) {
  const { t } = useTranslation('atlas')
  const [content, setContent] = useState<MirrorContent | null>(null)
  const [error, setError] = useState('')

  const fetchContent = useCallback(() => {
    AtlasService.MirrorContent(card.ID)
      .then(setContent)
      .catch((err) => setError(String(err)))
  }, [card.ID])

  useEffect(() => {
    setContent(null)
    setError('')
    fetchContent()
  }, [card.ID, card.MirrorPath, fetchContent])

  useAtlasMirrorChanged(card.ID, fetchContent)

  if (error) {
    return (
      <div className={noteStyles.mirrorFacePreview}>
        <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-drawio-face-error">{error}</Text>
      </div>
    )
  }
  if (!content) return null
  if (content.Missing) {
    return (
      <div className={noteStyles.mirrorFacePreview}>
        <AtlasMirrorMissingState
          testIdPrefix="atlas-drawio-face"
          onRepick={(path) => AtlasService.RepickCardMirror(card.ID, path)}
        />
      </div>
    )
  }
  if (content.TooLarge) {
    return (
      <div className={noteStyles.mirrorFacePreview}>
        <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-drawio-face-fallback">
          {t('overlay.mirrorTooLarge', { size: formatMirrorSize(content.Size) })}
        </Text>
      </div>
    )
  }

  return (
    <div className={noteStyles.mirrorFacePreview}>
      <DrawioDiagramHost source={content.Kind === MirrorKind.MirrorKindText ? content.Content : ''} interactive />
    </div>
  )
}
