import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactFlow, ReactFlowProvider, Background, Controls, useNodesState, useReactFlow } from '@xyflow/react'
import type { EdgeTypes as RFEdgeTypes, NodeTypes as RFNodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Card, Kind, Link, LinkKind, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { useIsNarrowViewport } from '../shared/useNarrowViewport'
import { usePrefersReducedMotion } from '../shared/usePrefersReducedMotion'
import { computeGroupFrameLayout, isGroupCard } from './atlasBoardLayout'
import { computeNoteBoxes, computeTopLevelBoxes } from './atlasBoardBoxes'
import { AtlasNoteCardNode } from './AtlasNoteCardNode'
import { AtlasGroupNode } from './AtlasGroupNode'
import { AtlasRegionChipNode } from './AtlasRegionChipNode'
import { AtlasStickyNode } from './AtlasStickyNode'
import { AtlasLinkEdge } from './AtlasLinkEdge'
import { resolveBoardEdges } from './atlasLinkResolution'
import { useAtlasArrange } from './useAtlasArrange'
import { buildBoardEdges } from './atlasBuildBoardEdges'
import { useBoardFocus } from './useBoardFocus'
import { useAtlasCreation, type AtlasGroupRequest, type AtlasPlacementRequest, type AtlasPromoteRequest } from './useAtlasCreation'
import { useAtlasAreaDraw } from './useAtlasAreaDraw'
import { useAtlasDragFiling, type FrameBox } from './useAtlasDragFiling'
import { useAtlasSelection } from './useAtlasSelection'
import { useAtlasSelectAll } from './useAtlasSelectAll'
import { useAtlasSelectionTray } from './useAtlasSelectionTray'
import { useAtlasSlotDrag } from './useAtlasSlotDrag'
import { AtlasSlotDragLine } from './AtlasSlotDragLine'
import { buildBoardCardNodes } from './atlasBuildBoardNodes'
import { buildStickyNodes } from './atlasStickyNodes'
import { AtlasCreationTray, ATLAS_TOOL_DRAG_MIME, type AtlasCreationTool } from './AtlasCreationTray'
import { AtlasSelectionTray } from './AtlasSelectionTray'
import { AtlasPlacementPopover } from './AtlasPlacementPopover'
import { useAtlasNativeFileDrop } from './useAtlasNativeFileDrop'
import { useAtlasPaste } from './useAtlasPaste'
import { FILE_DROP_CONTEXT_BOARD } from './atlasFileDropShared'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasBoard.module.css'

const rfNodeTypes: RFNodeTypes = { 'atlas-note': AtlasNoteCardNode, 'atlas-group': AtlasGroupNode, 'atlas-region-chip': AtlasRegionChipNode, 'atlas-sticky': AtlasStickyNode }
const rfEdgeTypes: RFEdgeTypes = { 'atlas-link': AtlasLinkEdge }

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
function AtlasBoardInner({ cards, allCards, kinds, links, linkKinds, notes, parentID, arrangeRequest, viewedID, focusRequest, onDrill, onOpenOverlay, onFocusHandled, onCardContextMenu, onPaneContextMenu, onArteryContextMenu, onNoteContextMenu, onFrameContextMenu, onFrameInteriorContextMenu, onMultiSelectContextMenu, onDeleteSelection, onGroupSelection, placementRequest, promoteRequest, groupRequest, onJumpToChip }: {
  cards: Card[]
  allCards: Card[]
  kinds: Kind[]
  links: Link[]
  linkKinds: LinkKind[]
  // Notes (goal 0081 slice A1) -- this board's own container's notes
  // only, same "already scoped by the caller" contract `cards` uses.
  // parentID is the board's CURRENT container (AtlasView's viewedID).
  notes: Note[]
  parentID: string
  // Arrange-is-an-action (goal 0089): a one-shot token; each bump
  // runs the packer over this level and PERSISTS the result.
  arrangeRequest?: number
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
  // Right-click on an artery (goal 0075 G4, goal 0081 A4's edge menu):
  // endpoints + its representative link id/count -- count gates the kind/label/remove items to 1.
  onArteryContextMenu: (sourceID: string, targetID: string, linkID: string, count: number, pos: { x: number; y: number }) => void
  // Right-click on a note (goal 0081 slice A1): same where/what-only
  // contract as onCardContextMenu -- AtlasView owns Promote/Delete.
  onNoteContextMenu: (noteID: string, pos: { x: number; y: number }) => void
  // Right-click on a frame's own header/border (goal 0081 slice A2,
  // LOCKED design §6d): reports the frame's own card id -- AtlasView
  // builds Add-inside/Zoom/Dissolve/Delete.
  onFrameContextMenu: (frameID: string, pos: { x: number; y: number }) => void
  // Right-click on a frame's own interior empty space (not on a
  // child): reports the frame's own card id -- AtlasView builds the
  // frame-scoped Add card/Add note pair.
  onFrameInteriorContextMenu: (frameID: string, pos: { x: number; y: number }) => void
  // Right-click on a member of a 2+ multi-selection: reports the
  // selection's own card/note ids split apart -- AtlasView builds
  // Group into new area (cards.length >= 2) / Delete.
  onMultiSelectContextMenu: (cardIDs: string[], noteIDs: string[], pos: { x: number; y: number }) => void
  // Keyboard Delete/Backspace over the live selection (goal 0089
  // rider): routed through the same confirm dialog as the menu item;
  // React Flow's own deleteKeyCode stays disabled -- a local node
  // removal would just resurrect on the next data refresh.
  onDeleteSelection: (cardIDs: string[], noteIDs: string[]) => void
  // The selection tray's own "Group into new area" -- the multi-select context menu's own dispatcher, reused.
  onGroupSelection: (cardIDs: string[], noteIDs: string[], pos: { x: number; y: number }) => void
  // AtlasView's own downward creation requests (the pane menu's "Add
  // card"/"Add note"/"Promote to card…" items, extended by slice A2's
  // frame-scoped placements and "Group into new area") -- see
  // useAtlasCreation.ts's own header comment for the shape.
  placementRequest?: AtlasPlacementRequest | null
  promoteRequest?: AtlasPromoteRequest | null
  groupRequest?: AtlasGroupRequest | null
  // A slot-row chip's own click (goal 0081 A4): reuses ⌘K's own focus/jump plumbing.
  onJumpToChip: (cardID: string) => void
}) {
  const { t } = useTranslation('atlas')
  const readOnly = useIsNarrowViewport()
  const reduceMotion = usePrefersReducedMotion()
  // Arrange is an action, not a mode (goal 0089): every level renders
  // positions-sovereign; the packer runs only on demand (below) or
  // in-memory for cards that have no position yet.
  const isFree = true
  const [flippedID, setFlippedID] = useState<string | null>(null)
  const [pulsedID, setPulsedID] = useState<string | null>(null)
  const [hintedID, setHintedID] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { fitBounds, fitView, getNodesBounds, screenToFlowPosition } = useReactFlow()

  // Free-mode overlap resolution (goal 0073, the growth class): a
  // frame's size is DERIVED from its children, so a clear layout can
  // start overlapping with nobody having moved a card. Resolved with
  // a deterministic minimal-displacement separation
  // (atlasOverlapResolution) and PERSISTED below, so the nudge is
  // stable across reloads. Leaf-on-leaf overlaps are hand placement
  // and never touched.
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

  // The board's arteries, resolved once and shared: the edges memo
  // below renders them; Auto-arrange consumes them as the adjacency
  // that seats linked things beside each other.
  const arteries = useMemo(() => resolveBoardEdges(links, new Set(cards.map((c) => c.ID)), allCards), [links, cards, allCards])

  const { freeMoves } = useAtlasArrange({ cards, allCards, arteries, boardWidth, arrangeRequest })

  // Rendered flow-space boxes (atlasBoardBoxes.ts, split at the
  // 500-line seam) -- Free mode only. Computed BEFORE useAtlasCreation
  // (below) so select-then-group can anchor the new container at its
  // members' own current box, not the triggering click point.
  const topLevelBoxes: FrameBox[] = useMemo(
    () => (isFree ? computeTopLevelBoxes(cards, allCards, freeMoves) : []),
    [cards, allCards, freeMoves, isFree],
  )
  const noteBoxes = useMemo(() => (isFree ? computeNoteBoxes(notes) : []), [notes, isFree])

  const creation = useAtlasCreation({ parentID, allCards, notes, readOnly, screenToFlowPosition, placementRequest, promoteRequest, groupRequest, cardBoxes: topLevelBoxes, noteBoxes })
  const selection = useAtlasSelection({ cards, notes, onMultiSelectContextMenu })

  // Delete/Backspace over a live selection -> the shared confirm
  // (never fires from editable elements; single or multi).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const el = document.activeElement
      if (el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
      const sel = selection.selectedIDsRef.current
      if (sel.length === 0) return
      e.preventDefault()
      const cardIDs = sel.filter((id) => cards.some((c) => c.ID === id))
      const noteIDs = sel.filter((id) => notes.some((n) => n.ID === id))
      if (cardIDs.length + noteIDs.length > 0) onDeleteSelection(cardIDs, noteIDs)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cards, notes, onDeleteSelection, selection.selectedIDsRef])

  const toggleFlip = useCallback((id: string) => setFlippedID((cur) => (cur === id ? null : id)), [])

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

  const dragFiling = useAtlasDragFiling({ allCards, parentID, topLevelBoxes, wrapperRef })

  // Slot-drag = instant typed link (goal 0081 A4): see useAtlasSlotDrag.ts.
  const slotDrag = useAtlasSlotDrag({
    topLevelBoxes, noteBoxes, screenToFlowPosition,
    onLink: (fromCardID, toCardID, linkKindID) => void AtlasService.CreateLink(fromCardID, toCardID, linkKindID, '').catch(console.error),
    onGuidedCreate: creation.openSlotLinkedCreate,
  })
  const removeLink = useCallback((linkID: string) => void AtlasService.DeleteLink(linkID).catch(console.error), [])

  const areaDraw = useAtlasAreaDraw({
    armed: isFree && !readOnly && creation.armedTool === 'area',
    screenToFlowPosition,
    cardBoxes: topLevelBoxes,
    noteBoxes,
    disarm: creation.disarm,
    onComplete: creation.openAreaPopover,
    wrapperRef,
  })

  // The capture doors (goal 0081 slice A3): own hook files, 500-line cap.
  const fileDrop = useAtlasNativeFileDrop({ parentID, topLevelBoxes, screenToFlowPosition, setPulsedID, reduceMotion })
  useAtlasPaste({ topLevelBoxes, screenToFlowPosition, onPasteText: creation.openPasteText })

  const builtNodes = useMemo(() => buildBoardCardNodes({
    cards, allCards, kinds, links, linkKinds, isFree, readOnly, boardWidth, freeMoves, arteries,
    flippedID, pulsedID, hintedID, hoveredFrameID: dragFiling.hoveredFrameID,
    toggleFlip, onOpenOverlay, handleDrill, handleLeafCommit,
    slotDragSourceID: slotDrag.dragSourceID, onSlotAnchorPointerDown: slotDrag.startDrag, onJumpToChip, onRemoveLink: removeLink,
  }), [cards, allCards, kinds, links, linkKinds, isFree, readOnly, flippedID, pulsedID, hintedID, onOpenOverlay, handleDrill, handleLeafCommit, freeMoves, arteries, boardWidth, dragFiling.hoveredFrameID, toggleFlip, slotDrag.dragSourceID, slotDrag.startDrag, onJumpToChip, removeLink])

  const [hoveredEdgeID, setHoveredEdgeID] = useState<string | null>(null)
  // Quiet edges (goal 0081 A4): see atlasBuildBoardEdges.ts.
  const edges = useMemo(() => buildBoardEdges(arteries, linkKinds, hoveredEdgeID, flippedID, t), [arteries, linkKinds, hoveredEdgeID, flippedID, t])

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
    // Rebuilt node objects don't carry selected:true, so an unadorned
    // setNodes silently dissolves a live multi-selection on every data
    // refresh -- re-apply it from the ref so a selection survives
    // rebuilds (and the context menu that follows one).
    const sel = selection.selectedIDsRef.current
    setNodes(sel.length > 0 ? allNodes.map((n) => (sel.includes(n.id) ? { ...n, selected: true } : n)) : allNodes)
  }, [allNodes, setNodes, selection.selectedIDsRef])

  useAtlasSelectAll({ cards, notes, setNodes })

  const { trayRef, hasSelection: haveSelection, onGroup: onTrayGroup, onDelete: onTrayDelete } = useAtlasSelectionTray({ selectedCards: selection.selectedCards, selectedNotes: selection.selectedNotes, clearSelection: selection.clearSelection, setNodes, onDeleteSelection, onGroupSelection, onUnflip: () => setFlippedID(null) })

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

  // Area drawing's own armed state (goal 0081 slice A2) disables React
  // Flow's own pane panning so the mousedown/mousemove/mouseup trio
  // below can own the drag instead -- shift-drag box-select (the
  // select-then-group door) is unaffected, since RF's own
  // selectionKeyCode handling is independent of panOnDrag.
  const areaArmed = isFree && !readOnly && creation.armedTool === 'area'

  const marqueeStyle = areaDraw.dragLocalRect
    ? { left: areaDraw.dragLocalRect.x, top: areaDraw.dragLocalRect.y, width: areaDraw.dragLocalRect.width, height: areaDraw.dragLocalRect.height }
    : null

  return (
    <div
      ref={wrapperRef}
      className={styles.board}
      data-testid="atlas-board"
      data-armed={creation.armedTool !== null}
      data-file-drop-target
      data-file-drop-context={FILE_DROP_CONTEXT_BOARD}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(ATLAS_TOOL_DRAG_MIME)) e.preventDefault()
      }}
      onDrop={onCanvasDrop}
      onPointerDownCapture={(e) => {
        selection.snapshotSelection()
        if (areaArmed) areaDraw.onPointerDown(e)
      }}
      onPointerMoveCapture={areaArmed ? areaDraw.onPointerMove : undefined}
      onPointerUpCapture={areaArmed ? areaDraw.onPointerUp : undefined}
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
        deleteKeyCode={null}
        // Goal 0092: NOT default Meta -- that made ⌘-click also toggle.
        multiSelectionKeyCode="Shift"
        nodesDraggable={isFree && !readOnly}
        zoomOnDoubleClick={false}
        panOnDrag={!areaArmed}
        // Un-filing (goal 0081 slice A2) means dragging a card TOWARD
        // and past the board's own visible edge, on purpose -- React
        // Flow's own default auto-pan-while-dragging would fight that
        // gesture, sliding the content back under the cursor instead
        // of ever letting it cross the edge.
        autoPanOnNodeDrag={false}
        onSelectionChange={selection.onSelectionChange}
        onSelectionContextMenu={selection.onSelectionContextMenu}
        onNodeContextMenu={(e, node) => {
          e.preventDefault()
          // A right-click on a member of a live 2+ multi-selection
          // opens the group menu (goal 0081 slice A2, LOCKED design 6d);
          // the hook reads its pre-clear snapshot, never live state.
          if (selection.tryNodeMultiMenu(node.id, { x: e.clientX, y: e.clientY })) return
          if (node.type === 'atlas-sticky') {
            onNoteContextMenu(node.id, { x: e.clientX, y: e.clientY })
            return
          }
          if (node.type === 'atlas-group') {
            // The header is the ONLY part of a frame's chrome that
            // isn't "interior empty space" -- everywhere else on the
            // frame's own DOM (its background, never a child node,
            // which captures its own right-click first) routes to the
            // frame-interior door instead of the full frame menu.
            const onHeader = !!(e.target as HTMLElement).closest('[data-testid="atlas-group-header"]')
            if (onHeader) onFrameContextMenu(node.id, { x: e.clientX, y: e.clientY })
            else onFrameInteriorContextMenu(node.id, { x: e.clientX, y: e.clientY })
            return
          }
          onCardContextMenu(node.id, { x: e.clientX, y: e.clientY })
        }}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault()
          const artery = arteries.find((a) => a.id === edge.id)
          onArteryContextMenu(edge.source, edge.target, edge.id, artery?.count ?? 1, { x: e.clientX, y: e.clientY })
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault()
          onPaneContextMenu({ x: e.clientX, y: e.clientY })
        }}
        // The armed tray tool's own placement click (goal 0081 slice
        // A1) -- a no-op when nothing is armed (creation.placeAt's own
        // guard, which also no-ops for the Area tool: its own
        // placement is the drag-drawn rect above, not a click).
        onPaneClick={(e) => creation.placeAt({ x: e.clientX, y: e.clientY })}
        // Narrow viewports never zoom out past 100% -- a board wider
        // than the screen pans instead of auto-shrinking every card
        // below its own real CSS pixel size (a touch target,
        // kind-glyph text) into an untappable miniature. Wide
        // viewports keep deep zoom-out (0.1): seeing the whole board
        // at once is the surface's core navigation model, and a
        // higher floor caps fitView on large boards.
        minZoom={readOnly ? 1 : 0.1}
        onNodeDrag={isFree && !readOnly ? dragFiling.onNodeDrag : undefined}
        onNodeDragStop={isFree && !readOnly ? dragFiling.onNodeDragStop : undefined}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.25, duration: reduceMotion ? 0 : 250 }}
      >
        <Background />
        <Controls />
      </ReactFlow>
      {marqueeStyle && <div className={styles.marquee} data-testid="atlas-area-marquee" style={marqueeStyle} />}
      {slotDrag.dragLine && <AtlasSlotDragLine line={slotDrag.dragLine} />}
      {fileDrop.dropError && <div className={`${styles.dropError} ${runbookStyles.error}`} data-testid="atlas-file-drop-error">{fileDrop.dropError}</div>}
      {fileDrop.dropDuplicateNotice && <div className={styles.dropNotice} data-testid="atlas-file-drop-duplicate-notice">{fileDrop.dropDuplicateNotice}</div>}
      {!readOnly && (haveSelection
        ? <AtlasSelectionTray ref={trayRef} selectedCardCount={selection.selectedCards.length} selectedNoteCount={selection.selectedNotes.length} onGroup={onTrayGroup} onDelete={onTrayDelete} />
        : <AtlasCreationTray armedTool={creation.armedTool} onToggle={creation.toggleArm} />)}
      {creation.popover && (
        <AtlasPlacementPopover
          mode={creation.popover.mode}
          anchorPos={creation.popover.anchorPos}
          kinds={kinds}
          initialTitle={creation.popover.initialTitle}
          enclosedCount={(creation.popover.enclosedCardIDs?.length ?? 0) + (creation.popover.enclosedNoteIDs?.length ?? 0)}
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
