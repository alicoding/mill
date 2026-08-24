import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NodeProps, Node as RFNode } from '@xyflow/react'
import { ImageIcon, PencilIcon } from '@primer/octicons-react'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import styles from './AtlasBoardObjectNode.module.css'

export interface AtlasBoardObjectData extends Record<string, unknown> {
  object: BoardObject
}

export type AtlasBoardObjectRFNode = RFNode<AtlasBoardObjectData>

// A board-local canvas object (goal 0179/0180's own correction: a
// canvas object is a thing in space, never a document) -- image and
// ink share this one component, discriminated by object.Kind purely
// for the fallback glyph while content loads; both render through the
// SAME mirrored-file door (ObjectMirrorContent), since both are
// file-backed (an image's own bytes, or ink's baked SVG stroke). No
// title, no flip, no connection handles -- structurally excluded from
// every card mechanism, the same way AtlasStickyNode's note is. Lands
// at its own natural/intrinsic size (clamped by this module's own CSS
// max-width/height so a full-resolution screenshot never dwarfs the
// board) until a future resize persists BoardObject.Size.
export const AtlasBoardObjectNode = memo(function AtlasBoardObjectNode({ data }: NodeProps<AtlasBoardObjectRFNode>) {
  const { t } = useTranslation('atlas')
  const { object } = data
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

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
  }, [object.ID, object.Payload])

  const Glyph = object.Kind === 'ink' ? PencilIcon : ImageIcon

  return (
    <div
      className={styles.object}
      data-testid="atlas-board-object"
      data-object-kind={object.Kind}
      role="img"
      aria-label={t(object.Kind === 'ink' ? 'boardObject.inkAriaLabel' : 'boardObject.imageAriaLabel')}
    >
      {src ? (
        <img className={styles.image} src={src} alt="" draggable={false} />
      ) : (
        <div className={styles.placeholder} data-testid="atlas-board-object-placeholder">
          <Glyph size={24} />
          {failed && <span className={styles.error}>{t('boardObject.loadFailed')}</span>}
        </div>
      )}
    </div>
  )
})
