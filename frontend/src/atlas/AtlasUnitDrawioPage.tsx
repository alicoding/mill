import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Stack, Text } from '@primer/react'
import { MirrorKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { MirrorContent } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import runbookStyles from '../shared/ListCard.module.css'
import { useDrawioRendering } from './useDrawioRendering'
import type { DrawioOverflowReporter } from './drawioInteraction'
import { useAtlasMirrorChanged } from './useAtlasMirrorChanged'
import { AtlasMirrorMissingState } from './AtlasMirrorMissingState'
import type { UnitRenderProps } from './unitRegistry'
import styles from './AtlasUnitDrawio.module.css'

function formatMirrorSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`
  return `${(bytes / (1000 * 1000)).toFixed(1)} MB`
}

// Isolated so the render-error state only remounts this element, not
// the page heading above it. Exported: AtlasDiagramObjectContent.tsx
// (goal 0179 S2) reuses this exact host for a "diagram" board object's
// own board face, rather than a second drawio-viewer wiring.
// `interactive` (goal 0340) makes the host a fixed viewport the drawing
// pans and zooms inside instead of a container the viewer grows to the
// whole drawing: the board-object face is a box on a canvas and has
// nowhere to grow to, while the card page's own bounded window keeps
// the viewer's default sizing. `onOverflow` rides along with it -- only
// a fixed frame can be exceeded.
export function DrawioDiagramHost({ source, interactive, onOverflow }: { source: string; interactive?: boolean; onOverflow?: DrawioOverflowReporter }) {
  const { t } = useTranslation('atlas')
  const hostRef = useRef<HTMLDivElement | null>(null)
  const renderError = useDrawioRendering(hostRef, source, { interactive, onOverflow })

  if (renderError) {
    return (
      <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-drawio-render-error">
        {t('drawio.renderError')}
      </Text>
    )
  }
  return <div ref={hostRef} className={interactive ? `${styles.diagramHost} ${styles.diagramFrame}` : styles.diagramHost} data-testid="atlas-drawio-page-body" />
}

// The standalone drawio unit's card-page presentation (ADR-0043, goal
// 0133 slice 3): fetches the card's own MirrorContent exactly as the
// mermaid unit does, then hands the raw .drawio XML to the vendored
// viewer instead of rendering it as text. Refetches live when the
// mirrored file changes on disk (goal 0194's live round-trip slice) --
// an external CLI/editor write reaches this page without a reload.
export function AtlasUnitDrawioPage({ card }: UnitRenderProps) {
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
    return <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-drawio-error">{error}</Text>
  }
  if (!content) {
    return <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-drawio-loading">{t('overlay.mirrorLoading')}</Text>
  }
  if (content.Missing) {
    return (
      <AtlasMirrorMissingState
        testIdPrefix="atlas-drawio"
        onRepick={(path) => AtlasService.RepickCardMirror(card.ID, path)}
      />
    )
  }
  if (content.TooLarge) {
    return (
      <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-drawio-fallback">
        {t('overlay.mirrorTooLarge', { size: formatMirrorSize(content.Size) })}
      </Text>
    )
  }

  return (
    <Stack direction="vertical" gap="condensed" data-testid="atlas-page-drawio">
      <Text weight="semibold">{t('drawio.pageHeading')}</Text>
      <DrawioDiagramHost source={content.Kind === MirrorKind.MirrorKindText ? content.Content : ''} />
    </Stack>
  )
}
