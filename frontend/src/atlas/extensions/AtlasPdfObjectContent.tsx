import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@primer/react'
import { FileIcon } from '@primer/octicons-react'
import type { BoardObject } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { MirrorReadState } from '../useAtlasObjectMirrorRead'
import { boardObjectContentFor } from '../atlasNounRegistry'
import { dispatchObjectEdit } from '../objectSeams'
import { applyTextAssistOff } from '../../shared/searchInputProps'
import nodeStyles from '../AtlasBoardObjectNode.module.css'
import styles from './AtlasPdfObjectContent.module.css'

// The pdf board object's face (goal 0267): the vendored pdf.js viewer
// -- Mozilla's own prebuilt web viewer, served from
// /vendor/pdfjs/web/viewer.html -- rendering the mirrored file's bytes
// from an in-memory blob URL. The whole converged PDF experience
// (paging, zoom, search, text selection) is the viewer's own UI, the
// same adopt-the-engine's-own-controls choice the drawio face made
// (goal 0259); Mill's code here is only the seam: bytes in, blob URL
// out, honest states around it.
function usePdfBlobUrl(base64: string | undefined): string | null {
  const url = useMemo(() => {
    if (!base64) return null
    const raw = atob(base64)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  }, [base64])
  // Revoke on change/unmount -- a blob URL pins its bytes in memory
  // until released.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return url
}

export function AtlasPdfObjectContent({ object, mirrorContent, preview }: { object: BoardObject; mirrorVersion: number; mirrorContent?: MirrorReadState; preview?: boolean }) {
  const { t } = useTranslation('atlas')
  const content = mirrorContent?.content
  // A frame's preview tile never boots the viewer -- a full pdf.js
  // iframe in a 190px slot is pure weight (it measurably slowed every
  // landing-board mount when the seeded document's tile did it), and
  // nothing in it is interactable there anyway. The blob hook still
  // runs (rules-of-hooks) but is fed nothing.
  const blobUrl = usePdfBlobUrl(preview ? undefined : (content?.Content || undefined))
  if (preview) {
    return (
      <div className={nodeStyles.placeholder} data-testid="atlas-pdf-preview-tile">
        <FileIcon size={24} />
      </div>
    )
  }

  // Same ADR-0046 shape as the sheet face's own button: read the
  // registered editRoute back, hand it to the host's one dispatch door.
  const openInDefaultApp = () => {
    const editRoute = boardObjectContentFor(object.Kind)?.editRoute
    if (!editRoute) return
    dispatchObjectEdit(object, editRoute).catch(() => {
      // The context menu's own "Open in default app" item surfaces the
      // same failure via its onError toast.
    })
  }

  if (content?.TooLarge) {
    return (
      <div className={nodeStyles.placeholder} data-testid="atlas-pdf-too-large">
        <FileIcon size={24} />
        <span>{t('boardObject.pdfTooLarge')}</span>
        <Button size="small" onClick={openInDefaultApp} className="nodrag">{t('boardObject.pdfOpenInApp')}</Button>
      </div>
    )
  }
  if (blobUrl) {
    return (
      <iframe
        className={styles.viewer}
        // #zoom=page-width: the first page fills the tile's width --
        // the readable default at board-object sizes; every other
        // control stays the viewer's own.
        src={`/vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(blobUrl)}#zoom=page-width`}
        title={t('boardObject.pdfViewerTitle')}
        data-testid="atlas-pdf-viewer"
        // The viewer's own toolbar inputs (findbar, page number) never
        // opt out of OS text assistance -- built for Firefox, which
        // has none -- so WKWebView autocorrects find queries as prose
        // (observed live: an acronym query drew the system suggestion
        // bubble inside the findbar and matched nothing). Applied here
        // at the seam so the vendored tree stays pristine; same-origin
        // by construction (the viewer is served from Mill's own
        // assets).
        onLoad={(e) => {
          const frame = e.currentTarget
          const doc = frame.contentDocument
          if (!doc) return
          applyTextAssistOff(doc, 'input.toolbarField, input#findInput')
          // Right-click inside the live viewer otherwise opens the
          // ENGINE's own frame menu (Open Frame in New Window, Reload
          // Frame -- dead items inside the app). Suppress it and
          // re-dispatch on the iframe element with translated
          // coordinates, so the canvas's own node context-menu path
          // opens the object menu -- one right-click behavior across
          // the whole object, shielded or live.
          doc.addEventListener('contextmenu', (ev) => {
            ev.preventDefault()
            const rect = frame.getBoundingClientRect()
            frame.dispatchEvent(new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + ev.clientX,
              clientY: rect.top + ev.clientY,
              button: 2,
            }))
          })
        }}
      />
    )
  }
  const failed = !!mirrorContent?.error || !!content?.Missing
  return (
    <div className={nodeStyles.placeholder} data-testid="atlas-board-object-placeholder">
      <FileIcon size={24} />
      {failed && <span className={nodeStyles.error}>{t('boardObject.loadFailed')}</span>}
    </div>
  )
}
