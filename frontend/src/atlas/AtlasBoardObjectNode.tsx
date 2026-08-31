import { memo, Suspense, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NodeResizer, useReactFlow } from '@xyflow/react'
import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { boardObjectContentFor } from './atlasNounRegistry'
import { unknownKindContent } from './atlasBoardObjectContent'
import { AtlasShapeRotateHandle } from './AtlasShapeRotateHandle'
import { useAtlasMirrorChanged } from './useAtlasMirrorChanged'
import { useAtlasObjectMirrorRead } from './useAtlasObjectMirrorRead'
import { useAtlasShapeRotateLive } from './atlasShapeRotateLiveStore'
import { dispatchObjectEdit, resolveEditRoute } from './objectSeams'
import styles from './AtlasBoardObjectNode.module.css'

export interface AtlasBoardObjectData extends Record<string, unknown> {
  object: BoardObject
  // Whether this object is the ONLY thing selected on the board right
  // now (goal 0214) -- computed once in AtlasBoard.tsx from the same
  // reactive selection split the tray/outline already re-render on,
  // never derived locally here (a plain per-node `selected` flag can't
  // tell "sole" from "part of a multi-selection").
  soleSelected: boolean
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
function AtlasBoardObjectNodeInner({ id, data, selected }: NodeProps<AtlasBoardObjectRFNode>) {
  const { t } = useTranslation('atlas')
  const { object, soleSelected } = data
  const { setNodes } = useReactFlow()
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
  // check here rather than moving into the registry. The rotation
  // handle (goal 0214) shares this exact carve-out for the same
  // reason -- an arrow's own geometry has no rotation angle to apply.
  const resizable = !(isShape && object.Payload?.shapeType === 'arrow')
  const shapeType = isShape ? object.Payload?.shapeType : undefined
  const rotatable = isShape && shapeType !== 'arrow'
  // The rotation transform lives on THIS box, not the shape's own SVG
  // (AtlasShapeContent.tsx no longer applies it) -- goal 0236's fix for
  // "state computed in one frame of reference, displayed in another":
  // every consumer that reads this box's geometry (the selection ring
  // below, NodeResizer's handles, the rotate handle's own anchor, real
  // pointer hit-testing) now shares the shape's actual rotated frame
  // instead of disagreeing with it. Read unconditionally (rules-of-
  // hooks) even though only a rotatable shape ever has a nonzero value.
  const liveRotation = useAtlasShapeRotateLive(object.ID)
  const rotationDeg = rotatable ? (liveRotation ?? (Number(object.Payload?.rotation) || 0)) : 0
  const boxRef = useRef<HTMLDivElement>(null)
  const facts = boardObjectContentFor(object.Kind)
  // The ONE shared watch subscription every fileBacked Kind inherits
  // (goal 0232 S1) -- called unconditionally (rules-of-hooks: `facts`
  // may be undefined below), id blank for a non-file-backed Kind so
  // useAtlasMirrorChanged's own no-op-while-empty guard skips
  // subscribing at all. Bumping a version counter (rather than each
  // Component re-subscribing itself) is what makes "declare fileBacked"
  // the entire tax a new family pays for live re-render.
  const [mirrorVersion, setMirrorVersion] = useState(0)
  useAtlasMirrorChanged(facts?.fileBacked ? object.ID : '', () => setMirrorVersion((v) => v + 1))
  // The kernel import boundary (ADR-0046, goal 0244 S1b): this read
  // used to live inside each fileBacked Kind's own content Component
  // (AtlasMirrorImageContent/AtlasSheetObjectContent/AtlasDiagramObjectContent),
  // each importing AtlasService directly. Relocated here so
  // extensions/ has no import path to it at all -- the result is
  // handed down as the mirrorContent prop below. Called unconditionally
  // (rules-of-hooks: `facts` may be undefined on the first render).
  const mirrorContent = useAtlasObjectMirrorRead(object.ID, object.Payload?.mirrorPath, facts?.fileBacked ?? false, mirrorVersion)

  // An unregistered Kind renders the fallback face instead of null
  // (docs/goals/0249's audit rider): a disabled/uninstalled plugin's
  // objects stay visible, selectable and deletable, and a built-in
  // registry/data mismatch becomes VISIBLE on the board instead of an
  // invisible node only a console reader could diagnose.
  const { Component, ariaLabelKey, role, dragBand } = facts ?? unknownKindContent
  // ADR-0046 (goal 0244 S1): double-click dispatches through the
  // object's own DECLARED edit route (resolved per-object, since a Kind
  // like diagram opens different doors for different mirror
  // extensions), never a hardcoded "if diagram, open drawio" check.
  // Only an embedded-engine route gets a double-click door -- an
  // external-app route (image/ink/sheet, and diagram's own mermaid
  // case) stays reachable via the context menu / an explicit button
  // only, matching every other file-backed Kind's convention of never
  // launching another app on an accidental double-click.
  const editRoute = facts?.editRoute ? resolveEditRoute(object, facts.editRoute) : undefined
  const editable = editRoute?.kind === 'embedded-engine'

  return (
    <div
      ref={boxRef}
      className={styles.object}
      style={{
        ...(hasSize ? { width: '100%', height: '100%' } : null),
        ...(rotationDeg ? { transform: `rotate(${rotationDeg}deg)`, transformOrigin: '50% 50%' } : null),
      }}
      data-testid="atlas-board-object"
      data-object-kind={object.Kind}
      data-shape-type={shapeType}
      role={role}
      aria-label={t(ariaLabelKey)}
      onDoubleClick={editable ? () => { void dispatchObjectEdit(object, editRoute!) } : undefined}
    >
      {/* The rotation handle (goal 0214): visible only when this shape
          is the board's SOLE selection -- never during a multi-select,
          never while a draw tool is armed (arming clears selection
          entirely, so soleSelected structurally can't be true then).
          Rectangle/ellipse only, matching the resizer's own arrow
          carve-out above. */}
      {rotatable && soleSelected && (
        <AtlasShapeRotateHandle objectID={object.ID} containerRef={boxRef} baseAngle={Number(object.Payload?.rotation) || 0} />
      )}
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
      {/* A dragBand Kind's content captures pointer events (the very
          fact dragBand declares), which also swallows the pointerdown
          React Flow's own click-to-select listens for -- so without
          this, the thin band above is the ONLY place a click can ever
          produce the selection ring and resize handles (goal 0259's
          dead end). Forwarding selection at capture phase runs before
          the content's own handlers can consume the event, and leaves
          propagation untouched: the viewer's toolbar/pan and a grid's
          cell edit keep working exactly as before. Mirrors React
          Flow's own click semantics: plain click selects just this
          node, shift/meta adds to the selection, and a click on an
          already-selected node changes nothing. */}
      <div
        className={styles.content}
        onPointerDownCapture={dragBand ? (e) => {
          // Primary button only: a right-click must reach the context
          // menu with the CURRENT selection intact (a multi-select
          // context menu reads it), never collapse it first.
          if (selected || e.button !== 0) return
          const additive = e.shiftKey || e.metaKey
          setNodes((nds) => nds.map((n) => (
            n.id === id ? { ...n, selected: true } : additive ? n : { ...n, selected: false }
          )))
        } : undefined}
      >
        <Suspense fallback={null}>
          {/* mirrorContent/fetchListProjection/repickMirror: the three
              host-resolved kernel seams a Kind's own Component may need
              (ADR-0046, goal 0244 S1b) -- passed uniformly to every
              Kind, the same "receives it, never changes" shape this
              file already gives mirrorVersion, rather than a per-Kind
              branch on which props to supply. */}
          <Component
            object={object}
            mirrorVersion={mirrorVersion}
            mirrorContent={mirrorContent}
            fetchListProjection={AtlasService.ObjectListProjection}
            repickMirror={(path) => AtlasService.RepickObjectMirror(object.ID, path)}
          />
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
