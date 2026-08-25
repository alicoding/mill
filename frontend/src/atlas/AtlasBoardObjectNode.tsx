import { memo, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { NodeResizer } from '@xyflow/react'
import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { boardObjectContentFor } from './atlasNounRegistry'
import styles from './AtlasBoardObjectNode.module.css'

export interface AtlasBoardObjectData extends Record<string, unknown> {
  object: BoardObject
}

export type AtlasBoardObjectRFNode = RFNode<AtlasBoardObjectData>

// A board-local canvas object (goal 0179/0180's own correction: a
// canvas object is a thing in space, never a document) -- every Kind
// shares this one renderer, discriminated purely by which content
// component/ariaLabel/role/dragBand its own noun declaration
// registered (goal 0215 S3, atlasNounRegistry.ts's own
// boardObjectContentFor). No title, no flip, no connection handles --
// structurally excluded from every card mechanism, the same way
// AtlasStickyNode's note is.
function AtlasBoardObjectNodeInner({ data, selected }: NodeProps<AtlasBoardObjectRFNode>) {
  const { t } = useTranslation('atlas')
  const { object } = data
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
  // rather than offering a handle that silently does nothing. This is
  // the one per-object (not per-Kind) exception, so it stays a payload
  // check here rather than moving into the registry.
  const resizable = !(isShape && object.Payload?.shapeType === 'arrow')
  const shapeType = isShape ? object.Payload?.shapeType : undefined
  const facts = boardObjectContentFor(object.Kind)

  if (!facts) {
    // Every persisted Kind self-registers a content contribution
    // (goal 0215 S3) -- reaching here means a BoardObject exists whose
    // own Kind has none, a registry/data mismatch this renderer cannot
    // recover from.
    console.error(`atlas board object "${object.ID}" has unregistered Kind "${object.Kind}"`)
    return null
  }
  const { Component, ariaLabelKey, role, dragBand } = facts

  return (
    <div
      className={styles.object}
      style={hasSize ? { width: '100%', height: '100%' } : undefined}
      data-testid="atlas-board-object"
      data-object-kind={object.Kind}
      data-shape-type={shapeType}
      role={role}
      aria-label={t(ariaLabelKey)}
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
      {/* Suspense boundary for every Kind uniformly, a no-op for a
          synchronously-imported Component (shape/image/ink) and the
          real code-split boundary for a lazy one (table/diagram, whose
          own content pulls @primer/react -- tools/tableTool.ts's own
          header explains why that stays lazy). */}
      <div className={styles.content}>
        <Suspense fallback={null}>
          <Component object={object} />
        </Suspense>
      </div>
    </div>
  )
}

// A board-local canvas object (goal 0179/0180's own correction: a
// canvas object is a thing in space, never a document) -- image, ink,
// shape, table and diagram share this one component, discriminated by
// object.Kind purely for which content to render; none get a title, a
// flip, or connection handles -- structurally excluded from every card
// mechanism, the same way AtlasStickyNode's note is. Lands at its own
// natural/intrinsic size (clamped by AtlasMirrorImageContent.tsx's own
// CSS max-width/height for image/ink so a full-resolution screenshot
// never dwarfs the board; a shape/table/diagram's own size is either
// user-drawn or content-derived, so it carries no such clamp) until a
// resize persists BoardObject.Size.
export const AtlasBoardObjectNode = memo(AtlasBoardObjectNodeInner)
