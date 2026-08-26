import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import type { Icon } from '@primer/octicons-react'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import styles from './AtlasBoardObjectNode.module.css'

// Shared file-backed content renderer for image/ink board objects
// (goal 0215 S3): both Kinds are structurally NOT mirror-IMAGE-backed
// in the same way table/diagram are (they resolve to base64 image
// bytes through the SAME mirrored-file door, ObjectMirrorContent), and
// differ only in their fallback glyph -- makeMirrorImageContent below
// parameterizes that one difference rather than branching on Kind at
// render time. Depends on Payload.mirrorPath (the one field that
// actually names which file's bytes this node renders), never the
// whole Payload object, since atlasStore's own refreshAtlas() hands
// every object a fresh Payload reference on any board mutation.
function AtlasMirrorImageContentInner({ object, mirrorVersion, Glyph }: { object: BoardObject; mirrorVersion: number; Glyph: Icon }) {
  const { t } = useTranslation('atlas')
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const hasSize = !!object.Size
  const mirrorPath = object.Payload?.mirrorPath

  // mirrorVersion (goal 0232 S1) rides in the dependency array so this
  // Kind is READY for the shared live-watch seam the moment a future
  // change adds image/ink extensions to armMirrorWatch's own gate
  // (internal/domain/atlas/mirror.go) -- today it never actually bumps
  // for this Kind (that gate stays diagram-only in this slice), so this
  // costs nothing yet but needs no further frontend change when it does.
  useEffect(() => {
    let stale = false
    setSrc(null)
    setFailed(false)
    AtlasService.ObjectMirrorContent(object.ID)
      .then((content) => {
        if (stale) return
        if (!content.MimeType || !content.Content) {
          setFailed(true)
          return
        }
        setSrc(`data:${content.MimeType};base64,${content.Content}`)
      })
      .catch(() => {
        if (!stale) setFailed(true)
      })
    return () => {
      stale = true
    }
  }, [object.ID, mirrorPath, mirrorVersion])

  return src ? (
    <img className={styles.image} data-sized={hasSize} src={src} alt="" draggable={false} />
  ) : (
    <div className={styles.placeholder} data-testid="atlas-board-object-placeholder">
      <Glyph size={24} />
      {failed && <span className={styles.error}>{t('boardObject.loadFailed')}</span>}
    </div>
  )
}

// makeMirrorImageContent -- each file-backed noun's own tools/<id>Tool.ts
// calls this once, at module scope, to build the Component its
// `content` declaration carries. Never called per-render.
export function makeMirrorImageContent(Glyph: Icon): ComponentType<{ object: BoardObject; mirrorVersion: number }> {
  return function AtlasMirrorImageContent({ object, mirrorVersion }: { object: BoardObject; mirrorVersion: number }) {
    return <AtlasMirrorImageContentInner object={object} mirrorVersion={mirrorVersion} Glyph={Glyph} />
  }
}
