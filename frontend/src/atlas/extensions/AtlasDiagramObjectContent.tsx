import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import { FlowchartIcon } from '@primer/octicons-react'
import { MirrorKind } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { BoardObject } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { MirrorReadState } from '../useAtlasObjectMirrorRead'
import { extensionOf } from '../unitRegistry'
import { DrawioDiagramHost } from '../AtlasUnitDrawioPage'
import { MermaidDiagramHost } from '../AtlasUnitMermaidPage'
import { AtlasMirrorMissingState } from '../AtlasMirrorMissingState'
import type { DrawioOverflowReporter } from '../drawioInteraction'
import runbookStyles from '../../shared/ListCard.module.css'
import nodeStyles from '../AtlasBoardObjectNode.module.css'
import drawioStyles from '../AtlasUnitDrawio.module.css'

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
export function AtlasDiagramObjectContent({ object, mirrorContent, repickMirror, preview, onOverflowChange }: { object: BoardObject; mirrorVersion: number; mirrorContent?: MirrorReadState; repickMirror?: (path: string) => Promise<unknown>; preview?: boolean; onOverflowChange?: DrawioOverflowReporter }) {
  const { t } = useTranslation('atlas')
  // Stable across renders: useDrawioRendering takes it as an effect
  // dependency, and a fresh identity every render would tear the viewer
  // down and rebuild it on every parent update.
  const onOverflow = useCallback<DrawioOverflowReporter>((exceeds, fit) => { onOverflowChange?.(exceeds, fit) }, [onOverflowChange])
  const content = mirrorContent?.content
  const error = mirrorContent?.error
  const mirrorPath = object.Payload?.mirrorPath ?? ''

  // A frame's preview tile never boots a diagram engine -- the same
  // call the pdf face makes for its own viewer iframe (goal 0267): the
  // vendored drawio viewer is a multi-megabyte script, nothing in a
  // capped tile is interactable, and a seeded diagram on the landing
  // board would otherwise pull that script into every app boot.
  if (preview) {
    return (
      <div className={nodeStyles.placeholder} data-testid="atlas-object-diagram-preview-tile">
        <FlowchartIcon size={24} />
      </div>
    )
  }

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
  if (MERMAID_EXTENSIONS.has(extensionOf(mirrorPath))) {
    const mermaid = <MermaidDiagramHost source={source} />
    return object.Size ? <div style={{ width: '100%', height: '100%' }}>{mermaid}</div> : mermaid
  }
  // The drawio face is always a FIXED frame (goal 0340) -- unsized it
  // takes the module's own default box, sized it takes the object's.
  return (
    <div className={drawioStyles.diagramObjectBox} style={object.Size ? { width: '100%', height: '100%' } : undefined}>
      <DrawioDiagramHost source={source} interactive onOverflow={onOverflow} />
    </div>
  )
}
