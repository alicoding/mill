import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import { MirrorKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { MirrorContent } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasCardMirrorPreview.module.css'

// 1000-based (KB/MB, not KiB/MiB) -- matches how a file's size is
// quoted everywhere else a user sees one (Finder, most OS file
// pickers), not the binary convention.
function formatMirrorSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`
  return `${(bytes / (1000 * 1000)).toFixed(1)} MB`
}

// Renders a card's MirrorPath read-only inside the overlay (docs/
// goals/0064): markdown through the Go-side converter (goldmark's
// default safe-render mode -- MirrorContent's own doc comment covers
// why dangerouslySetInnerHTML below is safe against an embedded raw
// <script>), plain text preformatted, an image inline via a base64
// data URI, and everything else (plus anything over the server's size
// cap) as a plain kind+size line -- the overlay's existing "Show in
// Finder" action covers the rest. Re-fetches whenever mirrorPath
// changes (a fresh "Update now" refresh, or the field itself edited
// and saved), never on every render.
export function AtlasCardMirrorPreview({ cardID, mirrorPath }: { cardID: string; mirrorPath: string }) {
  const { t } = useTranslation('atlas')
  const [content, setContent] = useState<MirrorContent | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setContent(null)
    setError('')
    AtlasService.MirrorContent(cardID)
      .then(setContent)
      .catch((err) => setError(String(err)))
  }, [cardID, mirrorPath])

  if (error) {
    return <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-mirror-error">{error}</Text>
  }
  if (!content) {
    return <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-mirror-loading">{t('overlay.mirrorLoading')}</Text>
  }

  if (content.TooLarge || content.Kind === MirrorKind.MirrorKindOther) {
    return (
      <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-mirror-fallback">
        {content.TooLarge
          ? t('overlay.mirrorTooLarge', { size: formatMirrorSize(content.Size) })
          : t('overlay.mirrorUnsupported', { size: formatMirrorSize(content.Size) })}
      </Text>
    )
  }

  if (content.Kind === MirrorKind.MirrorKindMarkdown) {
    return (
      <div
        className={styles.markdownBody}
        data-testid="atlas-mirror-markdown"
        // Safe: goldmark's default (non-unsafe) render mode never passes
        // raw HTML through unescaped -- render_test.go pins that property.
        dangerouslySetInnerHTML={{ __html: content.Content }}
      />
    )
  }

  if (content.Kind === MirrorKind.MirrorKindText) {
    return <pre className={styles.textBody} data-testid="atlas-mirror-text">{content.Content}</pre>
  }

  return <img className={styles.image} data-testid="atlas-mirror-image" src={`data:${content.MimeType};base64,${content.Content}`} alt={mirrorPath} />
}
