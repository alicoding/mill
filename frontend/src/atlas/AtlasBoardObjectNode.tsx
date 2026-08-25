import { memo, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NodeResizer } from '@xyflow/react'
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
// board) until a resize persists BoardObject.Size.
// A shape (goal 0169 slice 5) is structurally NOT mirror-file-backed --
// it renders straight from its own Payload/Size, so it takes an early,
// separate branch here rather than folding into the mirror-fetch effect
// below (which stays scoped to the two Kinds that actually have a
// mirror file, image and ink).
function AtlasBoardObjectNodeInner({ data, selected }: NodeProps<AtlasBoardObjectRFNode>) {
  const { t } = useTranslation('atlas')
  const { object } = data
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const isShape = object.Kind === 'shape'
  // A persisted Size wins forever (goal 0193's own no-auto-resize
  // rule) -- once set, the node's own RF width/height already carry
  // it (atlasBuildBoardObjectNodes.ts), so .object/.content just fill
  // that box instead of falling back to each Kind's natural sizing.
  const hasSize = !!object.Size
  // An arrow's own geometry is entirely payload.dx/dy (atlasTools.ts),
  // never a rectangular Size -- a generic corner-drag resize has no
  // sound mapping back onto a direction vector, and no backend call
  // exists to persist one, so arrows opt out of the shared resizer
  // rather than offering a handle that silently does nothing.
  const resizable = !(isShape && object.Payload?.shapeType === 'arrow')
  // "table" and "diagram" (goal 0179 S2) are structurally NOT
  // mirror-IMAGE-backed the way image/ink are: a table reads a List
  // projection, a diagram reads its own mirrored TEXT source through a
  // dedicated viewer host -- both take an early branch here, same
  // shape shape's own does, rather than folding into the image-mirror
  // fetch effect below (which stays scoped to the two Kinds that
  // actually resolve to base64 image bytes).
  const isTable = object.Kind === 'table'
  const isDiagram = object.Kind === 'diagram'
  // dragBand (goal 0206): table's own grid and a diagram's own vendored
  // pan/zoom viewer both capture pointer events, leaving nothing for a
  // plain node-drag to reach without a dedicated surface -- image/ink/
  // shape's whole body already drags, so the band would only be debris
  // there. Mirrors each tray tool's own dragBand declaration
  // (atlasNounRegistry.ts) for the four registered nouns; diagram has no
  // tray descriptor of its own (drop-only, goal 0179 S2) so it can't
  // declare the field there, but carries the same true answer here --
  // the same registry gap resizable/boardNodeType already carry for it.
  const dragBand = isTable || isDiagram

  // Depends on Payload.mirrorPath -- the one field that actually names
  // which file's bytes this node renders -- never the whole Payload
  // object. atlasStore's refreshAtlas() refetches every board object
  // on any board mutation (e.g. committing an unrelated stroke
  // elsewhere), handing every object a brand-new Payload reference
  // even when its own content is unchanged; depending on that
  // reference re-fires this fetch (and the synchronous setSrc(null)
  // above) for every already-rendered image/ink node, flashing each
  // one to its placeholder glyph and back for no reason (goal 0208).
  const mirrorPath = object.Payload?.mirrorPath
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
  }, [object.ID, mirrorPath, isShape, isTable, isDiagram])

  // Every Kind's own content, picked exactly as the pre-frame branches
  // did -- the ONE difference is that none of them return their own
  // wrapper div anymore. The shared wrapper (the return below) owns
  // that, so the drag-surface frame it renders is declared exactly
  // once regardless of how many Kinds this discriminant grows to.
  let content: ReactNode
  let role: 'img' | undefined = 'img'
  let ariaLabel: string
  let shapeType: string | undefined

  if (isShape) {
    content = <AtlasShapeContent object={object} />
    ariaLabel = t('boardObject.shapeAriaLabel')
    shapeType = object.Payload?.shapeType
  } else if (isTable) {
    // No role="img" here (unlike every sibling branch): a table's own
    // grid carries REAL interactive descendants (editable cells,
    // boundary-insert buttons) -- img's own ARIA semantics forbid
    // meaningful children, so this stays a plain labelled region.
    content = <AtlasTableObjectContent object={object} />
    role = undefined
    ariaLabel = t('boardObject.tableAriaLabel')
  } else if (isDiagram) {
    content = <AtlasDiagramObjectContent object={object} />
    ariaLabel = t('boardObject.diagramAriaLabel')
  } else {
    const Glyph = object.Kind === 'ink' ? PencilIcon : ImageIcon
    ariaLabel = t(object.Kind === 'ink' ? 'boardObject.inkAriaLabel' : 'boardObject.imageAriaLabel')
    content = src ? (
      <img className={styles.image} data-sized={hasSize} src={src} alt="" draggable={false} />
    ) : (
      <div className={styles.placeholder} data-testid="atlas-board-object-placeholder">
        <Glyph size={24} />
        {failed && <span className={styles.error}>{t('boardObject.loadFailed')}</span>}
      </div>
    )
  }

  return (
    <div
      className={styles.object}
      style={hasSize ? { width: '100%', height: '100%' } : undefined}
      data-testid="atlas-board-object"
      data-object-kind={object.Kind}
      data-shape-type={shapeType}
      role={role}
      aria-label={ariaLabel}
    >
      {/* React Flow's own resize handles (goal 0199 part B, adopting
          the same NodeResizer AtlasTableCardNode already uses -- never
          hand-rolled), shown on selection only (a board full of ink
          strokes would fight hover handles). Declared once here for
          every Kind, same reasoning the frame band below documents;
          arrow is the one carve-out (see the `resizable` comment
          above). onResizeEnd is the ONLY write -- nothing here ever
          resizes on its own (goal 0193). */}
      {resizable && (
        <NodeResizer
          isVisible={selected ?? false}
          minWidth={40}
          minHeight={40}
          onResizeEnd={(_e, params) => {
            void AtlasService.SetBoardObjectSize(object.ID, { W: params.width, H: params.height })
          }}
        />
      )}
      {/* The drag surface, declared exactly once here rather than per
          content renderer (goal 0199's #404 correction), but rendered
          ONLY for Kinds that need it (goal 0206's own correction to
          that fix): AtlasCardProjectionTable.tsx wraps a table's own
          grid in nodrag, and the vendored drawio viewer captures its
          own pointer events for pan/zoom -- both leave their Kind with
          NO surface a plain node-drag can reach otherwise.
          image/ink/shape's whole body already drags, so an unconditional
          band there rendered as a floating strip with nothing behind
          it -- gating on dragBand removes it from those Kinds entirely
          rather than leaving inert chrome. */}
      {dragBand && <div className={styles.frame} data-testid="atlas-board-object-frame" title={t('boardObject.dragHandleTitle')} />}
      <div className={styles.content}>{content}</div>
    </div>
  )
}

// A board-local canvas object (goal 0179/0180's own correction: a
// canvas object is a thing in space, never a document) -- image, ink,
// shape, table and diagram share this one component, discriminated by
// object.Kind purely for which content to render; none get a title, a
// flip, or connection handles -- structurally excluded from every card
// mechanism, the same way AtlasStickyNode's note is. Lands at its own
// natural/intrinsic size (clamped by this module's own CSS max-width/
// height for image/ink so a full-resolution screenshot never dwarfs the
// board; a shape/table/diagram's own size is either user-drawn or
// content-derived, so it carries no such clamp) until a resize persists
// BoardObject.Size.
export const AtlasBoardObjectNode = memo(AtlasBoardObjectNodeInner)
