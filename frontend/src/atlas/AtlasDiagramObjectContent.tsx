import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import { MirrorKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { BoardObject, MirrorContent } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { extensionOf } from './unitRegistry'
import { DrawioDiagramHost } from './AtlasUnitDrawioPage'
import { MermaidDiagramHost } from './AtlasUnitMermaidPage'
import runbookStyles from '../shared/ListCard.module.css'

const MERMAID_EXTENSIONS = new Set(['.mmd', '.mermaid'])

function formatMirrorSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`
  return `${(bytes / (1000 * 1000)).toFixed(1)} MB`
}

// A "diagram" object's own persisted render (goal 0179 S2): fetches the
// SAME ObjectMirrorContent every file-backed board object already uses
// (image/ink), then hands the raw source to the SAME viewer host a
// diagram CARD's own page mounts (DrawioDiagramHost/MermaidDiagramHost,
// re-exported from their Page modules) -- no second diagram-rendering
// wiring. Extension picks the host exactly as atlasUnitDrawio.ts/
// atlasUnitMermaid.ts's own detect() do for the card-page unit; a
// mermaid parse failure has no distinct error state (MermaidDiagramHost
// keeps the original source visible, matching the card-page unit).
export function AtlasDiagramObjectContent({ object }: { object: BoardObject }) {
  const { t } = useTranslation('atlas')
  const [content, setContent] = useState<MirrorContent | null>(null)
  const [error, setError] = useState('')
  const mirrorPath = object.Payload?.mirrorPath ?? ''

  useEffect(() => {
    setContent(null)
    setError('')
    AtlasService.ObjectMirrorContent(object.ID)
      .then(setContent)
      .catch((err) => setError(String(err)))
  }, [object.ID, mirrorPath])

  if (error) {
    return <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-object-diagram-error">{error}</Text>
  }
  if (!content) {
    return <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-object-diagram-loading">{t('overlay.mirrorLoading')}</Text>
  }
  if (content.TooLarge) {
    return (
      <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-object-diagram-fallback">
        {t('overlay.mirrorTooLarge', { size: formatMirrorSize(content.Size) })}
      </Text>
    )
  }

  const source = content.Kind === MirrorKind.MirrorKindText ? content.Content : ''
  if (MERMAID_EXTENSIONS.has(extensionOf(mirrorPath))) {
    return <MermaidDiagramHost source={source} />
  }
  return <DrawioDiagramHost source={source} />
}
