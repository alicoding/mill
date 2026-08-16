import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls, useNodesState, useReactFlow } from '@xyflow/react'
import type { NodeTypes as RFNodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ViewMode } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { useIsNarrowViewport } from '../shared/useNarrowViewport'
import { usePrefersReducedMotion } from '../shared/usePrefersReducedMotion'
import { childrenOf } from './atlasGrouping'
import { computeAutoArrangeLayout, computeGroupFrameLayout, isGroupCard, NOTE_HEIGHT, NOTE_WIDTH } from './atlasBoardLayout'
import { computeFreshnessRollup } from './atlasCardPresentation'
import { AtlasNoteCardNode, type AtlasNoteCardRFNode } from './AtlasNoteCardNode'
import { AtlasGroupNode, type AtlasGroupRFNode } from './AtlasGroupNode'
import styles from './AtlasBoard.module.css'

const rfNodeTypes: RFNodeTypes = { 'atlas-note': AtlasNoteCardNode, 'atlas-group': AtlasGroupNode }

type BoardRFNode = AtlasNoteCardRFNode | AtlasGroupRFNode

// A ⌘K jump's one-shot request into the board it lands on (goal 0072
// slice B): AtlasView decides WHETHER a re-root is needed (the target
// isn't rendered on the current board) and always supplies the target
// card id; AtlasBoard owns the camera and turns this into a fly-in +
// pulse + hint (or an immediate overlay open for the ⌘↵ path).
// AtlasView clears the request (via onFocusHandled) once the fly
// resolves, so the same jump never re-fires against a later render.
export interface AtlasFocusRequest {
  cardID: string
  openImmediately: boolean
}

// The pulse ring's own lifetime (goal 0072 slice B): two 600ms
// iterations of AtlasNoteCardNode/AtlasGroupNode's own pulse animation,
// or the reduced-motion static-outline's flat 1.5s -- kept here so the
// JS-side state clear and the CSS animation duration can't drift apart.
const PULSE_MS = 1200
const PULSE_MS_REDUCED = 1500
const HINT_LIFETIME_MS = 3000

// The one board every level renders through (goal 0072 slice A,
// retiring the old canvas/shelves split): Auto-arrange positions
// (deterministic, atlasBoardLayout.ts, never persisted, dragging off)
// vs Free (saved Position, drag persists via SetPosition) is a prop,
// not two components. A card with children renders as a region frame
// (AtlasGroupNode) whose own direct children render as separate,
// non-draggable preview nodes anchored inside it (parentId +
// extent:'parent') -- one nesting level deep, regardless of board
// mode; a childless card renders as a flippable note (AtlasNoteCardNode).
//
// The camera IS the navigation (goal 0072 slice B): a drill flies the
// camera into the target frame before re-rooting (handleDrill below),
// every re-root settles the new board with an animated fitView rather
// than an instant snap, and a ⌘K jump flies to + pulses + hints its
// target. prefers-reduced-motion collapses every duration to 0 (a
// static outline replaces the pulse's animated ring) -- the same
// media-query gate AtlasNoteCardNode.module.css's own flip already
// uses, read here in JS via usePrefersReducedMotion since React Flow's
// own transition durations are JS options, not CSS.
function AtlasBoardInner({ cards, allCards, kinds, links, linkKinds, mode, viewedID, focusRequest, onDrill, onOpenOverlay, onFocusHandled }: {
  cards: Card[]
  allCards: Card[]
  kinds: Kind[]
  links: Link[]
  linkKinds: LinkKind[]
  mode: ViewMode
  viewedID: string
  focusRequest: AtlasFocusRequest | null
  onDrill: (id: string) => void
  onOpenOverlay: (id: string) => void
  onFocusHandled: () => void
}) {
  const readOnly = useIsNarrowViewport()
  const reduceMotion = usePrefersReducedMotion()
  const isFree = mode === ViewMode.ViewModeCanvas
  const [flippedID, setFlippedID] = useState<string | null>(null)
  const [pulsedID, setPulsedID] = useState<string | null>(null)
  const [hintedID, setHintedID] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { fitBounds, fitView, getNodesBounds } = useReactFlow()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFlippedID(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const toggleFlip = (id: string) => setFlippedID((cur) => (cur === id ? null : id))

  // Zoom chip / group-header click / Enter on a region frame (routed
  // here through AtlasGroupNode's own data.onDrill) all fly the camera
  // into the frame's rendered bounds first, then re-root exactly once
  // when that transition resolves -- never before.
  const handleDrill = useCallback((groupID: string) => {
    const bounds = getNodesBounds([groupID])
    void fitBounds(bounds, { duration: reduceMotion ? 0 : 450, padding: 0.25 }).then(() => onDrill(groupID))
  }, [getNodesBounds, fitBounds, reduceMotion, onDrill])

  // Which card ids render on THIS board (top-level children plus one
  // level of group-preview grandchildren) -- kept in its own memo,
  // deliberately independent of flippedID/pulsedID/hintedID, since the
  // ⌘K focus effect below keys off this Set's IDENTITY to know when a
  // re-root has produced a fresh node set to fly against. Bundling it
  // with the visual-state-dependent builtNodes memo would hand it a
  // new identity on every pulse/hint/flip change too, re-triggering
  // that effect (and its cleanup) mid-animation -- the exact bug a
  // pulse being dismissed by its own state-set was rooted in.
  const renderedIDs = useMemo(() => {
    const ids = new Set<string>()
    for (const card of cards) {
      ids.add(card.ID)
      if (isGroupCard(allCards, card)) {
        for (const child of computeGroupFrameLayout(allCards, card.ID).children) ids.add(child.card.ID)
      }
    }
    return ids
  }, [cards, allCards])

  const builtNodes = useMemo(() => {
    const kindByID = new Map(kinds.map((k) => [k.ID, k]))
    const autoLayout = !isFree ? computeAutoArrangeLayout(cards, allCards) : null
    const nodes: BoardRFNode[] = []

    const noteData = (card: Card) => ({
      card,
      kind: kindByID.get(card.KindID),
      allCards,
      links,
      linkKinds,
      flipped: flippedID === card.ID,
      pulsed: pulsedID === card.ID,
      hinted: hintedID === card.ID,
      onToggleFlip: toggleFlip,
      onOpenOverlay,
    })

    for (const card of cards) {
      const box = autoLayout?.boxes.get(card.ID)
      const position = isFree ? { x: card.Position?.X ?? 0, y: card.Position?.Y ?? 0 } : { x: box?.x ?? 0, y: box?.y ?? 0 }

      if (isGroupCard(allCards, card)) {
        const frame = computeGroupFrameLayout(allCards, card.ID)
        const size = isFree ? frame.size : { width: box?.width ?? frame.size.width, height: box?.height ?? frame.size.height }
        nodes.push({
          id: card.ID,
          type: 'atlas-group',
          position,
          width: size.width,
          height: size.height,
          draggable: isFree && !readOnly,
          data: {
            card,
            kind: kindByID.get(card.KindID),
            childCount: childrenOf(allCards, card.ID).length,
            freshness: computeFreshnessRollup(frame.children.map((c) => c.card)),
            pulsed: pulsedID === card.ID,
            hinted: hintedID === card.ID,
            onDrill: handleDrill,
          },
        })
        for (const child of frame.children) {
          nodes.push({
            id: child.card.ID,
            type: 'atlas-note',
            position: child.position,
            width: NOTE_WIDTH,
            height: NOTE_HEIGHT,
            parentId: card.ID,
            extent: 'parent',
            draggable: false,
            data: noteData(child.card),
          })
        }
      } else {
        nodes.push({
          id: card.ID,
          type: 'atlas-note',
          position,
          width: NOTE_WIDTH,
          height: NOTE_HEIGHT,
          draggable: isFree && !readOnly,
          data: noteData(card),
        })
      }
    }
    return nodes
  }, [cards, allCards, kinds, links, linkKinds, isFree, readOnly, flippedID, pulsedID, hintedID, onOpenOverlay, handleDrill])

  const edges = useMemo(() => {
    const visible = links.filter((l) => renderedIDs.has(l.FromCardID) && renderedIDs.has(l.ToCardID))
    const linkKindByID = new Map(linkKinds.map((lk) => [lk.ID, lk]))
    return visible.map((l) => ({
      id: l.ID,
      source: l.FromCardID,
      target: l.ToCardID,
      type: 'default',
      label: linkKindByID.get(l.LinkKindID)?.Label ?? '',
      style: { stroke: 'var(--fgColor-accent)', strokeWidth: 1.6, opacity: 0.75 },
      labelStyle: { fontFamily: 'var(--mill-mono)', fontSize: 9 },
      interactionWidth: 8,
    }))
  }, [links, linkKinds, renderedIDs])

  const [nodes, setNodes, onNodesChange] = useNodesState(builtNodes)
  useEffect(() => {
    setNodes(builtNodes)
  }, [builtNodes, setNodes])

  // Every re-root (drill in, breadcrumb out, jump) settles the new
  // board with an animated fitView rather than an instant snap. The
  // very first paint stays on ReactFlow's own `fitView` prop below
  // (its internal fitViewQueued/nodesInitialized handshake is what
  // safely waits for nodes to be measured before fitting) -- this
  // effect only re-fires the SAME fit imperatively on every viewedID
  // change AFTER that first one, which is always a real user
  // interaction against an already-measured board, so no equivalent
  // wait is needed here.
  const hasMountedRef = useRef(false)
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }
    void fitView({ maxZoom: 1, padding: 0.25, duration: reduceMotion ? 0 : 250 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on viewedID (a new space to fit), not on every node/fitView identity change
  }, [viewedID])

  // AtlasView redefines onFocusHandled/onOpenOverlay inline on every one
  // of ITS OWN renders (unrelated to this board's pulse/hint state) --
  // latest-refs so the effect below reads the current callback without
  // taking a dependency on its identity, which would otherwise re-run
  // the effect (and its cleanup, dismissing an in-progress hint) on any
  // unrelated AtlasView re-render during the fly/pulse/hint window.
  const onFocusHandledRef = useRef(onFocusHandled)
  const onOpenOverlayRef = useRef(onOpenOverlay)
  useEffect(() => {
    onFocusHandledRef.current = onFocusHandled
    onOpenOverlayRef.current = onOpenOverlay
  }, [onFocusHandled, onOpenOverlay])

  // The ⌘K jump's fly (or immediate overlay open for ⌘↵): waits for
  // the target to actually be present in this board's rendered nodes
  // (a re-root AtlasView triggered first needs its own render pass
  // before the target exists here), then flies the camera to it at
  // ~zoom 1 by fitting a viewport-sized box centered on the node
  // rather than the node's own tiny bounds (fitBounds always clamps to
  // this pane's own maxZoom, which a 190x128 note card would otherwise
  // hit long before reaching "roughly full-size"). Clearing
  // focusRequest (onFocusHandled) deliberately happens here, once the
  // fly resolves -- setting pulsedID/hintedID is the ONLY other thing
  // this effect does; their own dismiss lifecycle lives in the
  // separate hint effect below, keyed on hintedID alone, specifically
  // so clearing focusRequest here (which re-runs THIS effect's own
  // cleanup on the next render) can never tear down a hint it just set.
  useEffect(() => {
    if (!focusRequest || !renderedIDs.has(focusRequest.cardID)) return
    let cancelled = false
    const nodeRect = getNodesBounds([focusRequest.cardID])
    const container = wrapperRef.current?.getBoundingClientRect()
    const w = container?.width ?? 800
    const h = container?.height ?? 600
    const cx = nodeRect.x + nodeRect.width / 2
    const cy = nodeRect.y + nodeRect.height / 2
    const bounds = { x: cx - w / 2, y: cy - h / 2, width: w, height: h }

    void fitBounds(bounds, { duration: reduceMotion ? 0 : 500, padding: 0 }).then(() => {
      if (cancelled) return
      onFocusHandledRef.current()
      if (focusRequest.openImmediately) {
        onOpenOverlayRef.current(focusRequest.cardID)
        return
      }
      const cardID = focusRequest.cardID
      setPulsedID(cardID)
      setHintedID(cardID)
      window.setTimeout(() => setPulsedID((cur) => (cur === cardID ? null : cur)), reduceMotion ? PULSE_MS_REDUCED : PULSE_MS)
    })

    return () => {
      cancelled = true
    }
  }, [focusRequest, renderedIDs, reduceMotion, fitBounds, getNodesBounds])

  // The hint chip's own lifecycle -- deliberately a separate effect
  // keyed only on hintedID (not on focusRequest, pulsedID, or any
  // callback identity), so its listeners/timer live and die exactly
  // with the hint itself: lives 3s, or until any keydown/pointerdown
  // (Enter opens the overlay first; any other key/click just dismisses).
  useEffect(() => {
    if (!hintedID) return
    const cardID = hintedID
    const dismiss = () => setHintedID((cur) => (cur === cardID ? null : cur))
    const onKeyDown = (e: KeyboardEvent) => {
      // Deferred one macrotask, not called inline: opening the overlay
      // (mounting Dialog's own focus trap) synchronously inside this
      // native keydown handler raced with that same trap's initial
      // focus-in, and the trap's focus-in on the still-live keydown
      // dispatch immediately closed the dialog it had just opened.
      if (e.key === 'Enter') window.setTimeout(() => onOpenOverlayRef.current(cardID), 0)
      dismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', dismiss)
    const timer = window.setTimeout(dismiss, HINT_LIFETIME_MS)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', dismiss)
      window.clearTimeout(timer)
    }
  }, [hintedID])

  return (
    <div ref={wrapperRef} className={`${styles.board} ${edges.length <= 3 ? styles.alwaysShowLabels : ''}`} data-testid="atlas-board" data-view-mode={mode}>
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={rfNodeTypes}
        nodesConnectable={false}
        nodesDraggable={isFree && !readOnly}
        zoomOnDoubleClick={false}
        // Narrow viewports never zoom out past 100% -- a board wider
        // than the screen pans instead of auto-shrinking every card
        // below its own real CSS pixel size (a touch target,
        // kind-glyph text) into an untappable miniature. Wide
        // viewports keep deep zoom-out (0.1): seeing the whole board
        // at once is the surface's core navigation model, and a
        // higher floor caps fitView on large boards.
        minZoom={readOnly ? 1 : 0.1}
        onNodeDragStop={
          isFree && !readOnly
            ? (_, node) => {
                if (node.parentId) return
                void AtlasService.SetPosition(node.id, { X: node.position.x, Y: node.position.y }).catch(console.error)
              }
            : undefined
        }
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.25, duration: reduceMotion ? 0 : 250 }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}

export function AtlasBoard(props: Parameters<typeof AtlasBoardInner>[0]) {
  return (
    <ReactFlowProvider>
      <AtlasBoardInner {...props} />
    </ReactFlowProvider>
  )
}
