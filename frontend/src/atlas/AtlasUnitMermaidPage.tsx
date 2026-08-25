import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Stack, Text } from '@primer/react'
import { MirrorKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { MirrorContent } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import runbookStyles from '../shared/ListCard.module.css'
import { useMermaidRendering } from './useMermaidRendering'
import { useAtlasMirrorChanged } from './useAtlasMirrorChanged'
import { AtlasMirrorMissingState } from './AtlasMirrorMissingState'
import type { UnitRenderProps } from './unitRegistry'
import styles from './AtlasUnitMermaid.module.css'

function formatMirrorSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`
  return `${(bytes / (1000 * 1000)).toFixed(1)} MB`
}

// Escapes raw mermaid source for embedding inside dangerouslySetInnerHTML's
// static markup below -- the source is plain text (MirrorKindText), never
// pre-escaped the way the markdown mirror's server-rendered HTML is.
function escapeForCodeBlock(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// The DOM subtree useMermaidRendering mutates directly (outside React's
// own reconciliation), isolated into its own memoized component keyed
// only by `source`: the parent overlay re-renders on unrelated state
// (live-sync ticks, saved-tick animation, ...) far more often than this
// content actually changes, and an ordinary (non-memoized) child would
// re-run React's own commit for this node on every one of those --
// which, since dangerouslySetInnerHTML's children are opaque to React
// but the div ITSELF still participates in the parent's commit, races
// the hook's own imperative DOM swap. memo's shallow prop compare skips
// that commit entirely whenever `source` hasn't actually changed, the
// same isolation boundary any DOM-library-owns-this-subtree integration
// (a chart, an editor) needs against its host framework.
// Exported: AtlasDiagramObjectContent.tsx (goal 0179 S2) reuses this
// exact host for a "diagram" board object's own board face, rather
// than a second mermaid-rendering wiring.
export const MermaidDiagramHost = memo(function MermaidDiagramHost({ source }: { source: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  useMermaidRendering(hostRef, source)
  return (
    <div
      ref={hostRef}
      className={styles.diagramHost}
      data-testid="atlas-mermaid-page-body"
      // Safe: escapeForCodeBlock neutralizes the only characters HTML
      // parsing treats specially inside a text node.
      dangerouslySetInnerHTML={{ __html: `<pre><code class="language-mermaid">${escapeForCodeBlock(source)}</code></pre>` }}
    />
  )
})

// The mermaid unit's card-page presentation (ADR-0043, goal 0133 slice
// 2): reuses useMermaidRendering exactly as the markdown mirror does,
// by giving it the same <pre><code class="language-mermaid"> shape
// goldmark's own fence output produces -- the hook itself needed no
// change to serve a standalone source file instead of a fenced block
// inside rendered markdown. Refetches live when the mirrored file
// changes on disk (goal 0194's live round-trip slice).
export function AtlasUnitMermaidPage({ card }: UnitRenderProps) {
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
    return <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-mermaid-error">{error}</Text>
  }
  if (!content) {
    return <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-mermaid-loading">{t('overlay.mirrorLoading')}</Text>
  }
  if (content.Missing) {
    return (
      <AtlasMirrorMissingState
        testIdPrefix="atlas-mermaid"
        onRepick={(path) => AtlasService.RepickCardMirror(card.ID, path)}
      />
    )
  }
  if (content.TooLarge) {
    return (
      <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-mermaid-fallback">
        {t('overlay.mirrorTooLarge', { size: formatMirrorSize(content.Size) })}
      </Text>
    )
  }

  return (
    <Stack direction="vertical" gap="condensed" data-testid="atlas-page-mermaid">
      <Text weight="semibold">{t('mermaid.pageHeading')}</Text>
      <MermaidDiagramHost source={content.Kind === MirrorKind.MirrorKindText ? content.Content : ''} />
    </Stack>
  )
}
