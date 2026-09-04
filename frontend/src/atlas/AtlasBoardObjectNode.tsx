import { memo, Suspense, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NodeResizer, useReactFlow } from '@xyflow/react'
import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { boardObjectContentFor } from './atlasNounRegistry'
import { usePluginReloadVersion } from '../plugins/pluginReloadSignal'
import { unknownKindContent, viewerOwnsWheel } from './atlasBoardObjectContent'
import type { AtlasBoardObjectContent } from './atlasBoardObjectContent'
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
  // Jump/entry pulse (goal 0265): objects are ⌘K jump peers, so the
  // same one-shot pulse ring card nodes render lands here too.
  pulsed?: boolean
  // Frame-preview tile (goal 0266): the object is being drawn inside
  // its parent frame's capped preview grid -- render the real face
  // clamped to the slot, but inert: no drag band, no edit
  // double-click, no resize, and content pointer events off so an
  // embedded viewer can't swallow frame clicks.
  preview?: boolean
}

export type AtlasBoardObjectRFNode = RFNode<AtlasBoardObjectData>

// What a Kind declaring overflowChip reports about itself: whether its
// content currently needs more room than the object's box gives it, and
// the action that fits it back inside (goal 0340).
interface ObjectOverflow {
  exceeds: boolean
  fit: () => void
}

// A board-local canvas object (goal 0179/0180's own correction: a
// canvas object is a thing in space, never a document) -- every Kind
// shares this one renderer, discriminated purely by which content
// component/ariaLabel/role/dragBand its own noun declaration
// registered (goal 0215 S3, atlasNounRegistry.ts's own
// boardObjectContentFor). No title, no flip, no connection handles --
// structurally excluded from every card mechanism, the same way
// AtlasStickyNode's note is.
// The per-render capability flags, pure and outside the component
// (also keeps the render function under the cognitive-complexity
// gate). A persisted Size wins forever (goal 0193's no-auto-resize
// rule) -- once set, the node's own RF width/height carry it
// (atlasBuildBoardObjectNodes.ts) and .object/.content just fill the
// box; a preview tile fills its slot the same way. An arrow's own
// geometry is entirely payload.dx/dy (atlasTools.ts) -- no sound
// mapping back from a corner-drag resize or a rotation angle, so
// arrows opt out of both handles (goals 0199/0214); a preview tile
// opts out of every interactive affordance by definition.
function objectNodeCaps(object: BoardObject, preview: boolean): { isShape: boolean; hasSize: boolean; resizable: boolean; shapeType: string | undefined; rotatable: boolean } {
  const isShape = object.Kind === 'shape'
  const arrow = isShape && object.Payload?.shapeType === 'arrow'
  return {
    isShape,
    hasSize: !!object.Size || preview,
    resizable: !preview && !arrow,
    shapeType: isShape ? object.Payload?.shapeType : undefined,
    rotatable: !preview && isShape && !arrow,
  }
}

function objectBoxClassName(wheelOptOut: boolean): string {
  return wheelOptOut ? `${styles.object} nowheel` : styles.object
}

// The content box's own class set. `nodrag` rides the same liveness
// window as `nowheel` (goal 0340, viewerOwnsWheel's own contract
// comment): while the face owns the pointer, a drag inside it must
// reach only the face -- the chrome band stays the object's drag
// surface.
function objectContentClassName(dragOptOut: boolean): string {
  return dragOptOut ? `${styles.content} nodrag` : styles.content
}

// Whether the chrome band shows its overflow escape hatch right now
// (goal 0340): the Kind declared one, this is a real object rather than
// a frame's inert tile, and its face currently reports that what it
// renders needs more room than the box gives it.
function showsFitChip(facts: Pick<AtlasBoardObjectContent, 'overflowChip'>, preview: boolean, overflow: ObjectOverflow | null): boolean {
  return !!facts.overflowChip && !preview && !!overflow?.exceeds
}

// The band's own tooltip. A shielded, not-yet-selected face reads as
// inert, so the band says what the first click buys before it is spent;
// once selected the band is back to being the object's drag handle.
function bandTitleKey(clickShield: boolean, selected: boolean): string {
  return clickShield && !selected ? 'boardObject.shieldedBandTitle' : 'boardObject.dragHandleTitle'
}

// The shield's own class set (goal 0273): a Kind that also declares a
// drag band keeps that band uncovered -- the band is that Kind's only
// drag and right-click surface, so shielding it would leave a shielded
// object with nothing to grab.
function clickShieldClassName(dragBand: boolean): string {
  return dragBand ? `${styles.clickShield} ${styles.clickShieldBelowBand}` : styles.clickShield
}

function AtlasBoardObjectNodeInner({ id, data, selected }: NodeProps<AtlasBoardObjectRFNode>) {
  const { t } = useTranslation('atlas')
  const { object, soleSelected } = data
  const preview = data.preview === true
  const { setNodes } = useReactFlow()
  const { hasSize, resizable, shapeType, rotatable } = objectNodeCaps(object, preview)
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
  // A plugin reload re-registers this Kind's face component; reading
  // the signal re-renders the node so the lookup below resolves the
  // fresh one (goal 0319). Built-in Kinds never change and simply
  // re-render identically.
  usePluginReloadVersion()
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
  const resolvedFacts = facts ?? unknownKindContent
  const { Component, ariaLabelKey, role, dragBand, clickShield } = resolvedFacts
  // Node-level rather than face-level because the kit resolves
  // `nowheel` by event-target ancestry and a wheel can land on node
  // chrome (drag band, padding) outside the face -- see
  // viewerOwnsWheel's own contract comment.
  const wheelOptOut = viewerOwnsWheel(resolvedFacts, preview, !!selected)
  // The Fit chip's own state (goal 0340): only the face can know
  // whether what it renders currently needs more room than this box
  // gives it, and only the face can fit it -- both arrive through the
  // one onOverflowChange call a Kind declaring overflowChip makes.
  const [overflow, setOverflow] = useState<ObjectOverflow | null>(null)
  // The ref is what the resizer reads: onResizeEnd runs from React
  // Flow's own handler, which closes over the render that installed it.
  const overflowRef = useRef<ObjectOverflow | null>(null)
  const onOverflowChange = useCallback((exceeds: boolean, fit: () => void) => {
    overflowRef.current = { exceeds, fit }
    setOverflow({ exceeds, fit })
  }, [])
  const showFitChip = showsFitChip(resolvedFacts, preview, overflow)
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
  const editable = !preview && editRoute?.kind === 'embedded-engine'

  return (
    <div
      ref={boxRef}
      className={objectBoxClassName(wheelOptOut)}
      style={{
        ...(hasSize ? { width: '100%', height: '100%' } : null),
        ...(rotationDeg ? { transform: `rotate(${rotationDeg}deg)`, transformOrigin: '50% 50%' } : null),
      }}
      data-testid={preview ? 'atlas-board-object-preview' : 'atlas-board-object'}
      data-object-kind={object.Kind}
      data-shape-type={shapeType}
      data-pulse={data.pulsed ? 'true' : undefined}
      data-preview={preview ? 'true' : undefined}
      role={role}
      // aria-label is PROHIBITED on a role-less (generic) element
      // (WCAG aria-prohibited-attr) -- only Kinds that declare a role
      // (img: image/diagram) may carry it. A preview tile is an inert
      // duplicate of content reachable by drilling in, hidden from AT
      // the way decorative repetition is; the frame header's own item
      // count announces membership.
      aria-label={role && !preview ? t(ariaLabelKey) : undefined}
      aria-hidden={preview ? true : undefined}
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
            // Refit an overflowing face to the box the user just chose
            // (goal 0340), on the next frame so the new size is laid
            // out before the face measures against it. This is the ONE
            // refit trigger: the face's own resize observer also fires
            // for a mount settling, which must never silently shrink a
            // drawing that has just appeared.
            const fit = overflowRef.current?.fit
            if (fit) requestAnimationFrame(fit)
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
      {dragBand && !preview && (
        <div className={styles.frame} data-testid="atlas-board-object-frame" title={t(bandTitleKey(!!clickShield, !!selected))}>
          {/* The overflow escape hatch (goal 0340): shown at rest and
              while selected, never hover-gated -- "this is bigger than
              what you can see" is a fact about the object, not a
              hover affordance. `nodrag` plus a swallowed pointerdown
              keep the click off the band's own drag. */}
          {showFitChip && (
            <button
              type="button"
              className={`${styles.fitChip} nodrag`}
              data-testid="atlas-board-object-fit"
              title={t('boardObject.fitChipTitle')}
              onPointerDown={(e) => { e.stopPropagation() }}
              onClick={(e) => { e.stopPropagation(); overflow?.fit() }}
            >
              {t('boardObject.fitChip')}
            </button>
          )}
        </div>
      )}
      {/* See clickShield's own contract comment (atlasBoardObjectContent.ts):
          an unselected shielded face selects/drags/right-clicks like a
          body; selecting lifts the shield and the face goes live. The
          band above stays uncovered where a Kind declares one -- it is
          that Kind's only drag surface. */}
      {clickShield && !preview && !selected && <div className={clickShieldClassName(dragBand)} data-testid="atlas-object-click-shield" />}
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
        className={objectContentClassName(wheelOptOut)}
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
            preview={preview}
            fetchListProjection={AtlasService.ObjectListProjection}
            repickMirror={(path) => AtlasService.RepickObjectMirror(object.ID, path)}
            onOverflowChange={onOverflowChange}
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
