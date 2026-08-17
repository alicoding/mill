import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactFlow, ReactFlowProvider, Background, Controls, useNodesState, useReactFlow } from '@xyflow/react'
import type { EdgeTypes as RFEdgeTypes, NodeTypes as RFNodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ViewMode } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Card, Kind, Link, LinkKind, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { useIsNarrowViewport } from '../shared/useNarrowViewport'
import { usePrefersReducedMotion } from '../shared/usePrefersReducedMotion'
import { childrenOf } from './atlasGrouping'
import { computeAutoArrangeLayout, computeGroupFrameLayout, isGroupCard, NOTE_HEIGHT, NOTE_WIDTH } from './atlasBoardLayout'
import { computeFreshnessRollup } from './atlasCardPresentation'
import { AtlasNoteCardNode, type AtlasNoteCardRFNode } from './AtlasNoteCardNode'
import { AtlasGroupNode, type AtlasGroupRFNode } from './AtlasGroupNode'
import { AtlasRegionChipNode, type AtlasRegionChipRFNode } from './AtlasRegionChipNode'
import { AtlasStickyNode, type AtlasStickyRFNode } from './AtlasStickyNode'
import { AtlasLinkEdge, type AtlasLinkRFEdge } from './AtlasLinkEdge'
import { resolveBoardEdges } from './atlasLinkResolution'
import { resolveFreeOverlaps } from './atlasOverlapResolution'
import { useBoardFocus } from './useBoardFocus'
import { useAtlasCreation, type AtlasPlacementRequest, type AtlasPromoteRequest } from './useAtlasCreation'
import { buildStickyNodes } from './atlasStickyNodes'
import { AtlasCreationTray, ATLAS_TOOL_DRAG_MIME, type AtlasCreationTool } from './AtlasCreationTray'
import { AtlasPlacementPopover } from './AtlasPlacementPopover'
import styles from './AtlasBoard.module.css'

const rfNodeTypes: RFNodeTypes = { 'atlas-note': AtlasNoteCardNode, 'atlas-group': AtlasGroupNode, 'atlas-region-chip': AtlasRegionChipNode, 'atlas-sticky': AtlasStickyNode }
const rfEdgeTypes: RFEdgeTypes = { 'atlas-link': AtlasLinkEdge }

type BoardRFNode = AtlasNoteCardRFNode | AtlasGroupRFNode | AtlasRegionChipRFNode | AtlasStickyRFNode

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
function AtlasBoardInner({ cards, allCards, kinds, links, linkKinds, notes, parentID, mode, viewedID, focusRequest, onDrill, onOpenOverlay, onFocusHandled, onCardContextMenu, onPaneContextMenu, onArteryContextMenu, onNoteContextMenu, placementRequest, promoteRequest }: {
  cards: Card[]
  allCards: Card[]
  kinds: Kind[]
  links: Link[]
  linkKinds: LinkKind[]
  // Notes (goal 0081 slice A1) -- this board's own container's notes
  // only, same "already scoped by the caller" contract `cards` uses.
  // parentID is the board's CURRENT container (AtlasView's viewedID):
  // every canvas-foremost creation door's own parent.
  notes: Note[]
  parentID: string
  mode: ViewMode
  viewedID: string
  focusRequest: AtlasFocusRequest | null
  onDrill: (id: string) => void
  onOpenOverlay: (id: string) => void
  onFocusHandled: () => void
  // Right-click on a card (goal 0075): the board only reports WHERE
  // and ON WHAT -- AtlasView owns the menu items (it holds the
  // card/share/delete context this component deliberately doesn't).
  onCardContextMenu: (cardID: string, pos: { x: number; y: number }) => void
  // Right-click on empty board (goal 0075's audit G3): same
  // where-only contract as the card opener above.
  onPaneContextMenu: (pos: { x: number; y: number }) => void
  // Right-click on an artery (goal 0075's audit G4): reports the two
  // top-level cards it connects -- AtlasView resolves their titles.
  onArteryContextMenu: (sourceID: string, targetID: string, pos: { x: number; y: number }) => void
  // Right-click on a note (goal 0081 slice A1): same where/what-only
  // contract as onCardContextMenu -- AtlasView owns Promote/Delete.
  onNoteContextMenu: (noteID: string, pos: { x: number; y: number }) => void
  // AtlasView's own downward creation requests (the pane menu's "Add
  // card"/"Add note"/"Promote to card…" items) -- see
  // useAtlasCreation.ts's own header comment for the shape.
  placementRequest?: AtlasPlacementRequest | null
  promoteRequest?: AtlasPromoteRequest | null
}) {
  const { t } = useTranslation('atlas')
  const readOnly = useIsNarrowViewport()
  const reduceMotion = usePrefersReducedMotion()
  const isFree = mode === ViewMode.ViewModeCanvas
  const [flippedID, setFlippedID] = useState<string | null>(null)
  const [pulsedID, setPulsedID] = useState<string | null>(null)
  const [hintedID, setHintedID] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { fitBounds, fitView, getNodesBounds, screenToFlowPosition } = useReactFlow()
  const creation = useAtlasCreation({ parentID, notes, readOnly, screenToFlowPosition, placementRequest, promoteRequest })

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
    // A commit supersedes a glance (goal 0074): entering a place
    // clears whatever was flipped before the camera moves.
    setFlippedID(null)
    const bounds = getNodesBounds([groupID])
    void fitBounds(bounds, { duration: reduceMotion ? 0 : 450, padding: 0.25 }).then(() => onDrill(groupID))
  }, [getNodesBounds, fitBounds, reduceMotion, onDrill])

  // A leaf's double-click commit (goal 0074): unflip, open its page.
  const handleLeafCommit = useCallback((cardID: string) => {
    setFlippedID(null)
    onOpenOverlay(cardID)
  }, [onOpenOverlay])

  // Which card ids ACTUALLY render on THIS board: top-level children
  // plus each frame's capped preview -- excluding a flipped frame's
  // children, which builtNodes omits while its back face covers them.
  // Honesty here is load-bearing twice over: the ⌘K/entry focus
  // effect below trusts this Set before flying (flying to an omitted
  // node meant a pulse on nothing), and resolveBoardEdges reattaches
  // links to a flipped frame instead of drawing to its missing
  // children. Kept independent of pulsedID/hintedID so a pulse's own
  // state-set never re-triggers the focus effect mid-animation;
  // flippedID IS a dependency now, deliberately -- an unflip must
  // re-fire that effect so a pending jump can land on the children it
  // just revealed.
  const renderedIDs = useMemo(() => {
    const ids = new Set<string>()
    for (const card of cards) {
      ids.add(card.ID)
      if (isGroupCard(allCards, card) && flippedID !== card.ID) {
        for (const child of computeGroupFrameLayout(allCards, card.ID).children) ids.add(child.card.ID)
      }
    }
    return ids
  }, [cards, allCards, flippedID])

  // Attention supersedes a glance: an incoming jump/entry focus
  // unflips whatever is flipped, so a target hidden behind a frame's
  // back face becomes real before the fly effect (re-fired by the
  // renderedIDs change above) goes looking for it.
  useEffect(() => {
    if (focusRequest) setFlippedID(null)
  }, [focusRequest])

  // Free-mode overlap resolution (goal 0073, the growth class): a
  // frame's size is DERIVED from its children, so a clear layout can
  // start overlapping with nobody having moved a card. Resolved with
  // a deterministic minimal-displacement separation
  // (atlasOverlapResolution) and PERSISTED below, so the nudge is
  // stable across reloads. Leaf-on-leaf overlaps are hand placement
  // and never touched.
  const freeMoves = useMemo(() => {
    if (isFree !== true) return []
    return resolveFreeOverlaps(cards.map((card) => {
      const frame = isGroupCard(allCards, card)
      const size = frame ? computeGroupFrameLayout(allCards, card.ID).size : { width: NOTE_WIDTH, height: NOTE_HEIGHT }
      return {
        id: card.ID,
        x: card.Position?.X ?? 0,
        y: card.Position?.Y ?? 0,
        width: size.width,
        height: size.height,
        isFrame: frame,
      }
    }))
  }, [cards, allCards, isFree])

  useEffect(() => {
    for (const m of freeMoves) {
      void AtlasService.SetPosition(m.id, { X: m.x, Y: m.y }).catch(console.error)
    }
  }, [freeMoves])

  // The board's arteries, resolved once and shared: the edges memo
  // below renders them; Auto-arrange consumes them as the adjacency
  // that seats linked things beside each other.
  const arteries = useMemo(() => resolveBoardEdges(links, new Set(cards.map((c) => c.ID)), allCards), [links, cards, allCards])

  // Auto-arrange rows wrap at the board's real width (a fixed cap
  // left a dead right-hand column); the pure-layout constant stays
  // the floor so a narrow pane still wraps.
  const [boardWidth, setBoardWidth] = useState(0)
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setBoardWidth(w)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const builtNodes = useMemo(() => {
    const kindByID = new Map(kinds.map((k) => [k.ID, k]))
    const adjacency = new Map<string, string[]>()
    for (const a of arteries) {
      adjacency.set(a.source, [...(adjacency.get(a.source) ?? []), a.target])
      adjacency.set(a.target, [...(adjacency.get(a.target) ?? []), a.source])
    }
    const autoLayout = !isFree ? computeAutoArrangeLayout(cards, allCards, adjacency, boardWidth > 0 ? boardWidth - 48 : undefined) : null
    const moveByID = new Map(freeMoves.map((m) => [m.id, m]))
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
      onCommit: handleLeafCommit,
    })

    for (const card of cards) {
      const box = autoLayout?.boxes.get(card.ID)
      const move = moveByID.get(card.ID)
      const position = isFree
        ? { x: move?.x ?? card.Position?.X ?? 0, y: move?.y ?? card.Position?.Y ?? 0 }
        : { x: box?.x ?? 0, y: box?.y ?? 0 }

      if (isGroupCard(allCards, card)) {
        const frame = computeGroupFrameLayout(allCards, card.ID)
        const size = isFree ? frame.size : { width: box?.width ?? frame.size.width, height: box?.height ?? frame.size.height }
        const groupFlipped = flippedID === card.ID
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
            allCards,
            links,
            linkKinds,
            childCount: childrenOf(allCards, card.ID).length,
            // Roll-up covers EVERY direct child, drawn or capped -- the
            // pills stay the deep truth regardless of the preview.
            freshness: computeFreshnessRollup(childrenOf(allCards, card.ID)),
            overflow: frame.overflow,
            pulsed: pulsedID === card.ID,
            hinted: hintedID === card.ID,
            flipped: groupFlipped,
            onDrill: handleDrill,
            onToggleFlip: toggleFlip,
            onOpenOverlay,
          },
        })
        // A flipped frame's own back face must visually and
        // interactively cover its own preview children -- React Flow
        // always renders a parentId child at parentZ+1 minimum
        // (@xyflow/system's own calculateChildXYZ), so a parent node
        // can never out-z-index its own children; omitting the
        // children entirely while flipped is what actually achieves
        // "z above the children," not a z-index that RF's own child
        // stacking invariant would silently defeat.
        if (!groupFlipped) {
          for (const child of frame.children) {
            if (child.variant === 'chip') {
              nodes.push({
                id: child.card.ID,
                type: 'atlas-region-chip',
                position: child.position,
                width: child.size.width,
                height: child.size.height,
                parentId: card.ID,
                extent: 'parent',
                draggable: false,
                data: {
                  card: child.card,
                  kind: kindByID.get(child.card.KindID),
                  childCount: childrenOf(allCards, child.card.ID).length,
                  pulsed: pulsedID === child.card.ID,
                  flipped: flippedID === child.card.ID,
                  onToggleFlip: toggleFlip,
                  onOpenOverlay,
                  onDrill: handleDrill,
                },
              })
            } else {
              nodes.push({
                id: child.card.ID,
                type: 'atlas-note',
                position: child.position,
                width: child.size.width,
                height: child.size.height,
                parentId: card.ID,
                extent: 'parent',
                draggable: false,
                data: noteData(child.card),
              })
            }
          }
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
  }, [cards, allCards, kinds, links, linkKinds, isFree, readOnly, flippedID, pulsedID, hintedID, onOpenOverlay, handleDrill, handleLeafCommit, freeMoves, arteries, boardWidth])

  const [hoveredEdgeID, setHoveredEdgeID] = useState<string | null>(null)
  const edges = useMemo(() => {
    const linkKindByID = new Map(linkKinds.map((lk) => [lk.ID, lk]))
    return arteries.map((r): AtlasLinkRFEdge => ({
      id: r.id,
      source: r.source,
      target: r.target,
      type: 'atlas-link',
      // A single link carries its kind's own label; an aggregated
      // artery labels as its count -- the per-link detail lives one
      // zoom level down and on the card page.
      label: r.count === 1 ? (linkKindByID.get(r.linkKindIDs[0])?.Label ?? '') : t('board.linksChip', { count: r.count }),
      style: { stroke: 'var(--fgColor-accent)', strokeWidth: r.count === 1 ? 1.6 : 2.2, opacity: 0.75 },
      interactionWidth: 8,
      data: { hovered: hoveredEdgeID === r.id },
    }))
  }, [arteries, linkKinds, hoveredEdgeID, t])

  // Sticky notes (goal 0081 slice A1): built separately from
  // builtNodes above (its own file, atlasStickyNodes.ts) since a note
  // is never a card and never enters the shelves auto-arrange/group-
  // frame layout that dominates that memo.
  const stickyNodes = useMemo(() => buildStickyNodes({
    notes, draftNotePos: creation.draftNoteFlowPos, editingNoteID: creation.editingNoteID, readOnly: readOnly || !isFree,
    onCommitDraft: creation.commitDraftNote, onCancelDraft: creation.cancelDraftNote,
    onEnterEdit: creation.enterNoteEdit, onCancelEdit: creation.cancelNoteEdit, onCommitEdit: creation.commitNoteEdit,
  }), [notes, creation.draftNoteFlowPos, creation.editingNoteID, readOnly, isFree, creation.commitDraftNote, creation.cancelDraftNote, creation.enterNoteEdit, creation.cancelNoteEdit, creation.commitNoteEdit])

  const allNodes = useMemo(() => [...builtNodes, ...stickyNodes], [builtNodes, stickyNodes])
  const [nodes, setNodes, onNodesChange] = useNodesState(allNodes)
  useEffect(() => {
    setNodes(allNodes)
  }, [allNodes, setNodes])

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


  useBoardFocus({ focusRequest, renderedIDs, reduceMotion, fitBounds, getNodesBounds, wrapperRef, onFocusHandled, onOpenOverlay, setPulsedID, setHintedID, hintedID })

  // Drag-from-tray placement (goal 0081 slice A1): the same
  // creation.placeAt an armed pane click uses, keyed off the payload
  // AtlasCreationTray.tsx's own onDragStart sets rather than armedTool
  // -- a drag-and-drop placement never arms the tool at all.
  const onCanvasDrop = (e: DragEvent) => {
    const tool = e.dataTransfer.getData(ATLAS_TOOL_DRAG_MIME) as AtlasCreationTool | ''
    if (!tool) return
    e.preventDefault()
    creation.placeAt({ x: e.clientX, y: e.clientY }, tool)
  }

  return (
    <div
      ref={wrapperRef}
      className={`${styles.board} ${edges.length <= 3 ? styles.alwaysShowLabels : ''}`}
      data-testid="atlas-board"
      data-view-mode={mode}
      data-armed={creation.armedTool !== null}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(ATLAS_TOOL_DRAG_MIME)) e.preventDefault()
      }}
      onDrop={onCanvasDrop}
    >
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={rfNodeTypes}
        edgeTypes={rfEdgeTypes}
        onEdgeMouseEnter={(_, edge) => setHoveredEdgeID(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdgeID(null)}
        nodesConnectable={false}
        nodesDraggable={isFree && !readOnly}
        zoomOnDoubleClick={false}
        onNodeContextMenu={(e, node) => {
          e.preventDefault()
          if (node.type === 'atlas-sticky') onNoteContextMenu(node.id, { x: e.clientX, y: e.clientY })
          else onCardContextMenu(node.id, { x: e.clientX, y: e.clientY })
        }}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault()
          onArteryContextMenu(edge.source, edge.target, { x: e.clientX, y: e.clientY })
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault()
          onPaneContextMenu({ x: e.clientX, y: e.clientY })
        }}
        // The armed tray tool's own placement click (goal 0081 slice
        // A1) -- a no-op when nothing is armed (creation.placeAt's own
        // guard).
        onPaneClick={(e) => creation.placeAt({ x: e.clientX, y: e.clientY })}
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
                if (node.type === 'atlas-sticky') {
                  void AtlasService.SetNotePosition(node.id, { X: node.position.x, Y: node.position.y }).catch(console.error)
                } else {
                  void AtlasService.SetPosition(node.id, { X: node.position.x, Y: node.position.y }).catch(console.error)
                }
              }
            : undefined
        }
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.25, duration: reduceMotion ? 0 : 250 }}
      >
        <Background />
        <Controls />
      </ReactFlow>
      {!readOnly && <AtlasCreationTray armedTool={creation.armedTool} onToggle={creation.toggleArm} />}
      {creation.popover && (
        <AtlasPlacementPopover
          mode={creation.popover.mode}
          anchorPos={creation.popover.anchorPos}
          kinds={kinds}
          initialTitle={creation.popover.initialTitle}
          onSubmit={creation.submitPopover}
          onCancel={creation.cancelPopover}
        />
      )}
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
