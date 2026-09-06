import { memo, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NodeResizer, useReactFlow } from '@xyflow/react'
import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { boardObjectContentFor } from './atlasNounRegistry'
import { usePluginReloadVersion } from '../plugins/pluginReloadSignal'
import { unknownKindContent } from './atlasBoardObjectContent'
import type { AtlasBoardObjectContent } from './atlasBoardObjectContent'
import type { DrawioPageCursor } from './drawioInteraction'
import { activation, faceOwnsInput, shieldUp } from './atlasActivation'
import type { AtlasActivation, AtlasInputMode } from './atlasActivation'
import { useAtlasObjectKeyBoundary } from './useAtlasObjectKeyBoundary'
import { AtlasShapeRotateHandle } from './AtlasShapeRotateHandle'
import { useAtlasMirrorChanged } from './useAtlasMirrorChanged'
import { useAtlasObjectMirrorRead } from './useAtlasObjectMirrorRead'
import { useAtlasShapeRotateLive } from './atlasShapeRotateLiveStore'
import { dispatchObjectEdit, resolveEditRoute } from './objectSeams'
import { useUISignalStore } from '../shared/uiSignalStore'
import { findCommand } from '../shared/commands'
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

// The face wrapper's own class set. All three canvas opt-outs ride the
// activation state, never a per-noun flag (goal 0354,
// atlasActivation.ts): a live face owns the wheel, the drag and the pan
// outright. They sit HERE rather than on the node box because the kit
// resolves each class by event-target ancestry, and the chrome band is
// a sibling of this wrapper -- so the band keeps panning the board
// while the face keeps every gesture that lands on it. An idle
// interactive face is inert instead, so nothing under the shield can
// swallow the click that selects.
function objectContentClassName(state: AtlasActivation, input: AtlasInputMode): string {
  if (faceOwnsInput(state)) return `${styles.content} nowheel nodrag nopan`
  return input === 'interactive' ? `${styles.content} ${styles.contentInert}` : styles.content
}

// useObjectActivation resolves this object's one input state and hands
// back the channel its face reports an open editor through (goal 0354).
// A deselect drops the report: an idle face has no editor the user can
// still be typing in, whatever it last said.
function useObjectActivation(input: AtlasInputMode, live: boolean): { state: AtlasActivation; onEditingChange: (editing: boolean) => void } {
  const [faceEditing, setFaceEditing] = useState(false)
  const state = activation(live, faceEditing, input)
  useEffect(() => { if (state === 'idle') setFaceEditing(false) }, [state])
  const onEditingChange = useCallback((editing: boolean) => { setFaceEditing(editing) }, [])
  return { state, onEditingChange }
}

// Whether the chrome band shows its overflow escape hatch right now
// (goal 0340): the Kind declared one, this is a real object rather than
// a frame's inert tile, and its face currently reports that what it
// renders needs more room than the box gives it.
function showsFitChip(facts: Pick<AtlasBoardObjectContent, 'overflowChip'>, preview: boolean, overflow: ObjectOverflow | null): boolean {
  return !!facts.overflowChip && !preview && !!overflow?.exceeds
}

// Whether the chrome band shows its page control right now (goal
// 0354): the Kind declared a pager, this is a real object rather than
// a frame's inert tile, and the face currently reports more than one
// page. A single-page file leaves the band exactly as it was.
function showsPager(facts: Pick<AtlasBoardObjectContent, 'pager'>, preview: boolean, cursor: DrawioPageCursor | null): boolean {
  return !!facts.pager && !preview && (cursor?.count ?? 0) > 1
}

// The band's own tooltip. A shielded, not-yet-selected face reads as
// inert, so the band says what the first click buys before it is spent;
// once selected the band is back to being the object's drag handle.
// The object's own edit door (ADR-0046, goal 0244 S1): the route its
// Kind DECLARES, resolved per object, plus whether a double-click may
// open it. Only an embedded-engine route gets that door -- an
// external-app one stays behind the context menu, so an accidental
// double-click never launches another app.
function editDoor(object: BoardObject, facts: AtlasBoardObjectContent | undefined, preview: boolean) {
  const route = facts?.editRoute ? resolveEditRoute(object, facts.editRoute) : undefined
  return { route, editable: !preview && route?.kind === 'embedded-engine' }
}

function bandTitleKey(state: AtlasActivation, input: AtlasInputMode, shieldHintKey: string | undefined): string {
  if (input !== 'interactive' || state !== 'idle') return 'boardObject.dragHandleTitle'
  return shieldHintKey ?? 'boardObject.shieldedBandTitle'
}

// The shield's own class set (goal 0273): a Kind that also declares a
// drag band keeps that band uncovered -- the band is that Kind's only
// drag and right-click surface, so shielding it would leave a shielded
// object with nothing to grab.
function clickShieldClassName(dragBand: boolean): string {
  return dragBand ? `${styles.clickShield} ${styles.clickShieldBelowBand}` : styles.clickShield
}

// The face's own page cursor, and the step the paging commands send
// (goal 0354): only the face can know where it is in a multi-page
// artifact, only the frame owns the band the control sits on -- the
// same split the Fit chip already makes. The command carries -1/+1 and
// names its target, so this frame answers only for its OWN object.
function useObjectPaging(objectID: string): { pageCursor: DrawioPageCursor | null; onPagerChange: (cursor: DrawioPageCursor) => void } {
  const [pageCursor, setPageCursor] = useState<DrawioPageCursor | null>(null)
  const pagerRef = useRef<DrawioPageCursor | null>(null)
  const onPagerChange = useCallback((cursor: DrawioPageCursor) => {
    pagerRef.current = cursor
    setPageCursor(cursor)
  }, [])
  const pageRequest = useUISignalStore((st) => st.atlasDiagramPageRequest)
  useEffect(() => {
    const cursor = pagerRef.current
    if (!pageRequest || pageRequest.id !== objectID || !cursor) return
    cursor.select(cursor.index + pageRequest.delta)
  }, [pageRequest, objectID])
  return { pageCursor, onPagerChange }
}

// What the band's page control publishes on the object's box: the
// commands' own enablement reads it back from the live canvas, so a
// single-page file (no control, no attributes) makes both paging
// commands honestly unavailable rather than dimmed.
function pagerDataAttrs(cursor: DrawioPageCursor | null): Record<string, string | undefined> {
  return { 'data-page-index': cursor ? String(cursor.index) : undefined, 'data-page-count': cursor ? String(cursor.count) : undefined }
}

// The band's own page control (goal 0354), a component of its own so
// the node's render function stays inside the complexity gate. Each
// arrow runs the SAME registry command the palette, the menu bar and
// the object's menu run -- never an inline page step of its own -- and
// stops at the file's ends rather than wrapping the way the vendored
// viewer's own buttons did. `nodrag` plus a swallowed pointerdown keep
// the clicks off the band's drag -- so the press selects the object
// itself instead, which is both what a click on an object's own chrome
// means and what makes the commands' "the selected diagram" target
// resolve to this one.
function ObjectBandPager({ cursor, onActivate }: { cursor: DrawioPageCursor; onActivate: () => void }) {
  const { t } = useTranslation('atlas')
  return (
    <div className={`${styles.pager} nodrag`} data-testid="atlas-board-object-pager">
      <button
        type="button"
        className={styles.pagerStep}
        data-testid="atlas-board-object-page-prev"
        title={t('boardObject.previousPage')}
        aria-label={t('boardObject.previousPage')}
        disabled={cursor.index <= 0}
        onPointerDown={(e) => { e.stopPropagation(); onActivate() }}
        onClick={(e) => { e.stopPropagation(); void findCommand('diagram.previousPage')?.run() }}
      >
        {'\u2039'}
      </button>
      <span className={styles.pagerLabel} data-testid="atlas-board-object-page-label">
        {t('boardObject.pageOf', { index: cursor.index + 1, count: cursor.count })}
      </span>
      <button
        type="button"
        className={styles.pagerStep}
        data-testid="atlas-board-object-page-next"
        title={t('boardObject.nextPage')}
        aria-label={t('boardObject.nextPage')}
        disabled={cursor.index >= cursor.count - 1}
        onPointerDown={(e) => { e.stopPropagation(); onActivate() }}
        onClick={(e) => { e.stopPropagation(); void findCommand('diagram.nextPage')?.run() }}
      >
        {'\u203a'}
      </button>
    </div>
  )
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
  const { Component, ariaLabelKey, role, dragBand, shieldHintKey } = resolvedFacts
  // The activation state (goal 0354): one contract for every noun and
  // every plugin face, derived from the noun's declared content mode
  // plus this object's own live state -- never a per-noun input flag.
  const { state, onEditingChange } = useObjectActivation(resolvedFacts.input, !!selected && !preview)
  useAtlasObjectKeyBoundary(boxRef, state)
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
  // "Fit diagram" from the object's own menu or the palette (goal
  // 0354): the command names the target and this frame holds the live
  // viewer's fit action, so it answers only for its OWN object. The
  // same action the Fit chip runs -- one fit, two doors.
  const fitRequest = useUISignalStore((st) => st.atlasDiagramFitRequest)
  useEffect(() => {
    if (!fitRequest || fitRequest.id !== object.ID) return
    overflowRef.current?.fit()
  }, [fitRequest, object.ID])
  const { pageCursor, onPagerChange } = useObjectPaging(object.ID)
  const selectThisNode = useCallback(() => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, selected: true } : { ...n, selected: false })))
  }, [id, setNodes])
  const showPager = showsPager(resolvedFacts, preview, pageCursor)
  const showFitChip = showsFitChip(resolvedFacts, preview, overflow)
  const { route: editRoute, editable } = editDoor(object, facts, preview)

  return (
    <div
      ref={boxRef}
      className={styles.object}
      style={{
        ...(hasSize ? { width: '100%', height: '100%' } : null),
        ...(rotationDeg ? { transform: `rotate(${rotationDeg}deg)`, transformOrigin: '50% 50%' } : null),
      }}
      data-testid={preview ? 'atlas-board-object-preview' : 'atlas-board-object'}
      data-object-kind={object.Kind}
      data-shape-type={shapeType}
      data-pulse={data.pulsed ? 'true' : undefined}
      data-preview={preview ? 'true' : undefined}
      data-activation={state}
      {...pagerDataAttrs(showPager ? pageCursor : null)}
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
        <div className={styles.frame} data-testid="atlas-board-object-frame" title={t(bandTitleKey(state, resolvedFacts.input, shieldHintKey))}>
          {/* One trailing cluster for the band's own controls: the
              page control, then the overflow escape hatch. Both are
              shown at rest and while selected, never hover-gated --
              "this has more to it than you can see" is a fact about
              the object, not a hover affordance. */}
          <div className={styles.bandActions}>
          {/* The page control (goal 0354): the object's own chrome for a
              multi-page artifact, since a board object shows no vendored
              toolbar. Right-aligned with the Fit chip; each arrow runs
              the same registry command the palette and the object's menu
              run, and stops at the file's own ends rather than wrapping.
              `nodrag` plus a swallowed pointerdown keep the clicks off
              the band's own drag. */}
            {showPager && pageCursor && <ObjectBandPager cursor={pageCursor} onActivate={selectThisNode} />}
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
        </div>
      )}
      {/* Object first, content second (atlasActivation.ts's own
          contract): an idle interactive face selects/drags/right-clicks
          like a body; selecting lifts the shield and the face goes
          live. The band above stays uncovered where a Kind declares one
          -- it is that Kind's only drag surface. */}
      {shieldUp(resolvedFacts.input, state, preview) && <div className={clickShieldClassName(dragBand)} data-testid="atlas-object-click-shield" />}
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
        className={objectContentClassName(state, resolvedFacts.input)}
        data-testid="atlas-board-object-face"
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
            onEditingChange={onEditingChange}
            onPagerChange={onPagerChange}
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
