import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import { MirrorKind } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { BoardObject } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { MirrorReadState } from '../useAtlasObjectMirrorRead'
import { extensionOf } from '../unitRegistry'
import { DrawioDiagramHost } from '../AtlasUnitDrawioPage'
import { MermaidDiagramHost } from '../AtlasUnitMermaidPage'
import { AtlasMirrorMissingState } from '../AtlasMirrorMissingState'
import runbookStyles from '../../shared/ListCard.module.css'

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
//
// A resize (goal 0199 part B) persists BoardObject.Size and moves the
// RF node's own box, but the two vendored hosts' own bounded-window
// CSS (AtlasUnitDrawio.module.css/AtlasUnitMermaid.module.css, shared
// with the card-page unit views) keeps its own independent min/max-
// height -- this wrapper carries the persisted box so a future host
// change can honor it, but does not itself override that shared CSS.
//
// The read itself (ObjectMirrorContent) and its live-reload timing
// (goal 0194's mirrorVersion round-trip) now both live in the host
// (AtlasBoardObjectNode.tsx's own useAtlasObjectMirrorRead, ADR-0046
// goal 0244 S1b) -- this component only interprets the settled
// mirrorContent it's handed: a version bump refetches WITHOUT resetting
// content first, so an external edit swaps the rendered diagram in
// place with no loading flash, exactly as before relocation.
export function AtlasDiagramObjectContent({ object, mirrorContent, repickMirror }: { object: BoardObject; mirrorVersion: number; mirrorContent?: MirrorReadState; repickMirror?: (path: string) => Promise<unknown> }) {
  const { t } = useTranslation('atlas')
  const content = mirrorContent?.content
  const error = mirrorContent?.error
  const mirrorPath = object.Payload?.mirrorPath ?? ''

  if (error) {
    return <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-object-diagram-error">{error}</Text>
  }
  if (!content) {
    return <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-object-diagram-loading">{t('overlay.mirrorLoading')}</Text>
  }
  if (content.Missing) {
    return (
      <AtlasMirrorMissingState
        testIdPrefix="atlas-object-diagram"
        onRepick={(path) => (repickMirror ? repickMirror(path) : Promise.reject(new Error('no repickMirror host seam')))}
      />
    )
  }
  if (content.TooLarge) {
    return (
      <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-object-diagram-fallback">
        {t('overlay.mirrorTooLarge', { size: formatMirrorSize(content.Size) })}
      </Text>
    )
  }

  const source = content.Kind === MirrorKind.MirrorKindText ? content.Content : ''
  const host = MERMAID_EXTENSIONS.has(extensionOf(mirrorPath))
    ? <MermaidDiagramHost source={source} />
    : <DrawioDiagramHost source={source} />
  return object.Size ? <div style={{ width: '100%', height: '100%' }}>{host}</div> : host
}
