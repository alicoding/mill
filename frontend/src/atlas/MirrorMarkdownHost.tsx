import type { ReactElement } from 'react'
import { memo, useRef } from 'react'
import { useMermaidRendering } from './useMermaidRendering'
import styles from './AtlasCardMirrorPreview.module.css'

// The markdown mirror's rendered-HTML host, isolated behind memo for the
// same reason MermaidDiagramHost is (see AtlasUnitMermaidPage.tsx): React
// compares dangerouslySetInnerHTML's wrapper object by reference, so an
// inline `{ __html }` literal makes EVERY parent re-render (freshness
// tick, server event) re-assign this div's innerHTML -- wiping whatever
// the mermaid hook's async render already inserted and stranding the
// fence nodes the hook captured, a wipe whose window widens with engine
// load time. Keyed only by the html string, memo's shallow compare skips
// the commit whenever the mirrored content hasn't actually changed.
export const MirrorMarkdownHost = memo(function MirrorMarkdownHost({ html }: { html: string }): ReactElement {
  const markdownRef = useRef<HTMLDivElement | null>(null)
  useMermaidRendering(markdownRef, html)
  return (
    <div
      ref={markdownRef}
      className={styles.markdownBody}
      data-testid="atlas-mirror-markdown"
      // Safe: goldmark's default (non-unsafe) render mode never passes
      // raw HTML through unescaped -- render_test.go pins that property.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})
