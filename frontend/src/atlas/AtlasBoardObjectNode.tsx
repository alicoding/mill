import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NodeProps, Node as RFNode } from '@xyflow/react'
import { ImageIcon, PencilIcon } from '@primer/octicons-react'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { AtlasShapeContent } from './AtlasShapeContent'
import { AtlasTableObjectContent } from './AtlasTableObjectContent'
import { AtlasDiagramObjectContent } from './AtlasDiagramObjectContent'
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
// A shape (goal 0169 slice 5) is structurally NOT mirror-file-backed --
// it renders straight from its own Payload/Size, so it takes an early,
// separate branch here rather than folding into the mirror-fetch effect
// below (which stays scoped to the two Kinds that actually have a
// mirror file, image and ink).
function AtlasBoardObjectNodeInner({ data }: NodeProps<AtlasBoardObjectRFNode>) {
  const { t } = useTranslation('atlas')
  const { object } = data
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const isShape = object.Kind === 'shape'
  // "table" and "diagram" (goal 0179 S2) are structurally NOT
  // mirror-IMAGE-backed the way image/ink are: a table reads a List
  // projection, a diagram reads its own mirrored TEXT source through a
  // dedicated viewer host -- both take an early branch here, same
  // shape shape's own does, rather than folding into the image-mirror
  // fetch effect below (which stays scoped to the two Kinds that
  // actually resolve to base64 image bytes).
  const isTable = object.Kind === 'table'
  const isDiagram = object.Kind === 'diagram'

  useEffect(() => {
    if (isShape || isTable || isDiagram) return
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
  }, [object.ID, object.Payload, isShape, isTable, isDiagram])

  if (isShape) {
    return (
      <div className={styles.object} data-testid="atlas-board-object" data-object-kind="shape" data-shape-type={object.Payload?.shapeType} role="img" aria-label={t('boardObject.shapeAriaLabel')}>
        <AtlasShapeContent object={object} />
      </div>
    )
  }

  if (isTable) {
    // No role="img" here (unlike every sibling branch): a table's own
    // grid carries REAL interactive descendants (editable cells,
    // boundary-insert buttons) -- img's own ARIA semantics forbid
    // meaningful children, so this stays a plain labelled region.
    return (
      <div className={styles.object} data-testid="atlas-board-object" data-object-kind="table" aria-label={t('boardObject.tableAriaLabel')}>
        <AtlasTableObjectContent object={object} />
      </div>
    )
  }

  if (isDiagram) {
    return (
      <div className={styles.object} data-testid="atlas-board-object" data-object-kind="diagram" role="img" aria-label={t('boardObject.diagramAriaLabel')}>
        <AtlasDiagramObjectContent object={object} />
      </div>
    )
  }

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
}

// A board-local canvas object (goal 0179/0180's own correction: a
// canvas object is a thing in space, never a document) -- image, ink,
// and shape share this one component, discriminated by object.Kind
// purely for which content to render; none get a title, a flip, or
// connection handles -- structurally excluded from every card
// mechanism, the same way AtlasStickyNode's note is. Lands at its own
// natural/intrinsic size (clamped by this module's own CSS max-width/
// height for image/ink so a full-resolution screenshot never dwarfs the
// board; a shape's own size is already user-drawn, so it carries no
// such clamp) until a future resize persists BoardObject.Size.
export const AtlasBoardObjectNode = memo(AtlasBoardObjectNodeInner)
