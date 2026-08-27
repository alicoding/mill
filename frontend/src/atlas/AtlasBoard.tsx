import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useRenderStormGuard } from '../shared/renderStormGuard'
import { useTranslation } from 'react-i18next'
import { ReactFlow, ReactFlowProvider, useNodesState, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AtlasService } from '../shared/bindings'
import { useIsNarrowViewport } from '../shared/useNarrowViewport'
import { usePrefersReducedMotion } from '../shared/usePrefersReducedMotion'
import { computeGroupFrameLayout, isGroupCard } from './atlasBoardLayout'
import { computeNoteBoxes, computeObjectBoxes, computeTopLevelBoxes } from './atlasBoardBoxes'
import { rfEdgeTypes, rfNodeTypes } from './atlasBoardNodeTypes'
import { AtlasBoardChrome } from './AtlasBoardChrome'
import { resolveBoardEdges } from './atlasLinkResolution'
import { useAtlasArrange } from './useAtlasArrange'
import { useAtlasEdgeInteraction } from './useAtlasEdgeInteraction'
import { useBoardFocus } from './useBoardFocus'
import { useAtlasCreation } from './useAtlasCreation'
import { useAtlasArmedTool } from './useAtlasArmedTool'
import { useAtlasToolGesture } from './useAtlasToolGesture'
import { ATLAS_TOOLS } from './atlasTools'
import type { AtlasGestureCtx } from './atlasNounRegistry'
import { useAtlasDragFiling, type FrameBox } from './useAtlasDragFiling'
import { AtlasDragHighlightContext } from './atlasDragHighlightContext'
import type { AtlasBoardInnerProps } from './atlasBoardInnerProps'
import { useAtlasSelection } from './useAtlasSelection'
import { useAtlasSelectAll } from './useAtlasSelectAll'
import { useAtlasSelectionTray } from './useAtlasSelectionTray'
import { useAtlasKeyboardNav } from './useAtlasKeyboardNav'
import { useAtlasMinimapToggle } from './useAtlasMinimapToggle'
import { useAtlasSlotDrag } from './useAtlasSlotDrag'
import { AtlasSlotDragLine } from './AtlasSlotDragLine'
import { buildBoardCardNodes } from './atlasBuildBoardNodes'
import { buildStickyNodes } from './atlasStickyNodes'
import { buildBoardObjectNodes } from './atlasBuildBoardObjectNodes'
import { AtlasCreationTray, ATLAS_TOOL_DRAG_MIME } from './AtlasCreationTray'
import type { AtlasCreationTool } from './atlasTools'
import { useTablePickerSignal } from './useTablePickerSignal'
import { useAtlasImagePopoverSignal } from './useAtlasImagePopoverSignal'
import { useAtlasImageCreate } from './useAtlasImageCreate'
import { useAtlasPaneClick } from './useAtlasPaneClick'
import { AtlasSelectionTray } from './AtlasSelectionTray'
import { AtlasPlacementPopover } from './AtlasPlacementPopover'
import { useAtlasNativeFileDrop } from './useAtlasNativeFileDrop'
import { useAtlasPaste } from './useAtlasPaste'
import { useAtlasClipboard } from './useAtlasClipboard'
import { FILE_DROP_CONTEXT_BOARD } from './atlasFileDropShared'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasBoard.module.css'

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
function AtlasBoardInner({ boardFilter, onBoardFilterChange, filterMatchCount, filterTotalCount, filterPresentKindIDs, cards, allCards, kinds, links, linkKinds, notes, allNotes, objects, parentID, arrangeRequest, viewedID, focusRequest, onDrill, onOpenOverlay, onFocusHandled, onCardContextMenu, onPaneContextMenu, onArteryContextMenu, onEdgeDeleteLink, onEdgeChangeKind, onNoteContextMenu, onObjectContextMenu, onFrameContextMenu, onFrameInteriorContextMenu, onMultiSelectContextMenu, onDeleteSelection, onGroupSelection, onPasteConverted, onCreateTableSized, onOpenTableFromList, onQuietToast, onOpenNote, placementRequest, promoteRequest, groupRequest }: AtlasBoardInnerProps) {
  const { t } = useTranslation('atlas')
  const readOnly = useIsNarrowViewport()
  const reduceMotion = usePrefersReducedMotion()
  // Arrange is an action, not a mode (goal 0089): every level renders
  // positions-sovereign; the packer runs only on demand (below) or
  // in-memory for cards that have no position yet.
  const isFree = true
  const [pulsedID, setPulsedID] = useState<string | null>(null)
  const [hintedID, setHintedID] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { fitBounds, fitView, getNodesBounds, getViewport, setViewport, screenToFlowPosition } = useReactFlow()

  // Free-mode overlap resolution (goal 0073, the growth class): a frame's size is DERIVED
  // from its children, so a clear layout can start overlapping with nobody having moved a
  // card. Resolved with a deterministic minimal-displacement separation (atlasOverlapResolution)
  // and PERSISTED below, so the nudge is stable across reloads. Leaf-on-leaf overlaps stay hand
  // placement. Auto-arrange rows wrap at the board's real width; the layout constant is the floor
  // so a narrow pane still wraps.
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

  // The board's arteries, resolved once and shared: the edges memo below renders them;
  // Auto-arrange consumes them as the adjacency that seats linked things beside each other.
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

  // The ONE shared armed-tool field (useAtlasArmedTool.ts, goal 0238):
  // every arming door below -- useAtlasCreation's own card/note/area/
  // pencil/eraser/laser/shape, the table size picker, the image
  // popover -- reads/writes this SAME state, so arming any one of them
  // disarms whichever other one was armed, by construction.
  const armedTool = useAtlasArmedTool()
  const tablePicker = useTablePickerSignal({ armedToolId: armedTool.armedToolId, arm: armedTool.arm, disarm: armedTool.disarm })
  const imagePopover = useAtlasImagePopoverSignal({ armedToolId: armedTool.armedToolId, arm: armedTool.arm, disarm: armedTool.disarm })
  const imageCreate = useAtlasImageCreate({ allCards, viewedID })
  const creation = useAtlasCreation({ parentID, allCards, kinds, notes, objects, readOnly, screenToFlowPosition, placementRequest, promoteRequest, groupRequest, cardBoxes: topLevelBoxes, noteBoxes, armedToolId: armedTool.armedToolId, armedToolLocked: armedTool.locked, armSharedTool: armedTool.arm, disarmShared: armedTool.disarm, toggleShared: armedTool.toggle })
  const selection = useAtlasSelection({ cards, notes, objects, onMultiSelectContextMenu })
  const wrapperClicks = useAtlasPaneClick({ tablePicker, topLevelBoxes, screenToFlowPosition, onCreateTableSized, placeAt: creation.placeAt })

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
      const objectIDs = sel.filter((id) => objects.some((o) => o.ID === id))
      if (cardIDs.length + noteIDs.length + objectIDs.length > 0) onDeleteSelection(cardIDs, noteIDs, objectIDs)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cards, notes, objects, onDeleteSelection, selection.selectedIDsRef])

  // Zoom chip / group-header click / Enter on a region frame (routed
  // here through AtlasGroupNode's own data.onDrill) all fly the camera
  // into the frame's rendered bounds first, then re-root exactly once
  // when that transition resolves -- never before.
  const handleDrill = useCallback((groupID: string) => {
    const bounds = getNodesBounds([groupID])
    void fitBounds(bounds, { duration: reduceMotion ? 0 : 450, padding: 0.25 }).then(() => onDrill(groupID))
  }, [getNodesBounds, fitBounds, reduceMotion, onDrill])

  // Which card ids ACTUALLY render on THIS board: top-level children
  // plus each frame's capped preview. Honesty here is load-bearing for
  // the ⌘K/entry focus effect below, which trusts this Set before
  // flying, and for resolveBoardEdges, which reattaches links to a
  // frame's own children by the same set. Kept independent of
  // pulsedID/hintedID so a pulse's own state-set never re-triggers the
  // focus effect mid-animation.
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

  const dragFiling = useAtlasDragFiling({ allCards, parentID, topLevelBoxes, wrapperRef })

  // Slot-drag = instant typed link (goal 0081 A4): see useAtlasSlotDrag.ts.
  const slotDrag = useAtlasSlotDrag({
    topLevelBoxes, noteBoxes, allCards, kinds, screenToFlowPosition,
    onLink: (fromCardID, toCardID, linkKindID) => void AtlasService.CreateLink(fromCardID, toCardID, linkKindID, '').catch(console.error),
    onGuidedCreate: creation.openSlotLinkedCreate,
  })

  // The capture doors (goal 0081 slice A3): own hook files, 500-line cap.
  const fileDrop = useAtlasNativeFileDrop({ parentID, topLevelBoxes, screenToFlowPosition, setPulsedID, reduceMotion })
  useAtlasPaste({ topLevelBoxes, screenToFlowPosition, viewedID, onPasteConverted, onNoteCreated: selection.selectNote })
  useAtlasClipboard({ allCards, allNotes, links, kinds, selectedCardIDs: selection.selectedCards, selectedNoteIDs: selection.selectedNotes, topLevelBoxes, screenToFlowPosition, viewedID, readOnly, showToast: onQuietToast })

  // Handle honesty: no kind restricts linking, so zero legal targets means a board with nothing else on it.
  const hasLegalTargets = renderedIDs.size > 1

  // Deliberately excludes dragFiling.hoveredFrameID (goal 0161 slice
  // 1): a frame boundary crossing must never invalidate this memo --
  // that highlight reaches AtlasGroupNode through
  // AtlasDragHighlightContext instead, below, so only frame nodes
  // re-render on a crossing rather than the whole board.
  const builtNodes = useMemo(() => buildBoardCardNodes({
    cards, allCards, allNotes, kinds, links, linkKinds, isFree, readOnly, boardWidth, freeMoves, arteries,
    pulsedID, hintedID,
    isSoleSelected: selection.isSoleSelected, onOpenOverlay, handleDrill,
    slotDragSourceID: slotDrag.dragSourceID, onSlotAnchorPointerDown: slotDrag.startDrag, hasLegalTargets, boardFilter, titleEditCardID: creation.editingTitleCardID, onTitleCommit: creation.commitCardTitle, onTitleCancel: creation.cancelCardTitle,
    noteHandlers: { editingNoteID: creation.editingNoteID, onEnterEdit: creation.enterNoteEdit, onCancelEdit: creation.cancelNoteEdit, onCommitEdit: creation.commitNoteEdit, onOpenNote },
  }), [cards, allCards, allNotes, kinds, links, linkKinds, isFree, readOnly, pulsedID, hintedID, onOpenOverlay, handleDrill, freeMoves, arteries, boardWidth, selection.isSoleSelected, slotDrag.dragSourceID, slotDrag.startDrag, hasLegalTargets, boardFilter, creation.editingTitleCardID, creation.commitCardTitle, creation.cancelCardTitle, creation.editingNoteID, creation.enterNoteEdit, creation.cancelNoteEdit, creation.commitNoteEdit, onOpenNote])

  const { edges, setHoveredEdgeID, onSelectionChange } = useAtlasEdgeInteraction({
    arteries, linkKinds, cards, kinds, t, onEdgeDeleteLink, onEdgeChangeKind, onNodeSelectionChange: selection.onSelectionChange,
  })

  // Sticky notes (goal 0081 slice A1): built separately from
  // builtNodes above (its own file, atlasStickyNodes.ts) since a note
  // is never a card and never enters the shelves auto-arrange/group-
  // frame layout that dominates that memo.
  const stickyNodes = useMemo(() => buildStickyNodes({
    notes, draftNotePos: creation.draftNoteFlowPos, editingNoteID: creation.editingNoteID, readOnly: readOnly || !isFree,
    isSoleSelected: selection.isSoleSelected,
    onCommitDraft: creation.commitDraftNote, onCancelDraft: creation.cancelDraftNote,
    onEnterEdit: creation.enterNoteEdit, onCancelEdit: creation.cancelNoteEdit, onCommitEdit: creation.commitNoteEdit, onOpenNote,
  }), [notes, creation.draftNoteFlowPos, creation.editingNoteID, readOnly, isFree, selection.isSoleSelected, creation.commitDraftNote, creation.cancelDraftNote, creation.enterNoteEdit, creation.cancelNoteEdit, creation.commitNoteEdit, onOpenNote])

  // The board's own sole-selected object id (goal 0214) -- "sole"
  // means nothing ELSE (card, note, or another object) is selected
  // alongside it, not merely that this one object's own id is present,
  // so the rotation handle never appears mid-multi-select.
  const soleSelectedObjectID = useMemo(() => (
    selection.selectedCards.length === 0 && selection.selectedNotes.length === 0 && selection.selectedObjects.length === 1
      ? selection.selectedObjects[0]
      : null
  ), [selection.selectedCards, selection.selectedNotes, selection.selectedObjects])

  // Board objects (goal 0179/0180): built separately, same reasoning
  // sticky notes' own comment gives -- a board object is never a card
  // and never enters the group-frame preview layout either.
  const objectNodes = useMemo(() => buildBoardObjectNodes({ objects, readOnly, isFree, soleSelectedID: soleSelectedObjectID }), [objects, readOnly, isFree, soleSelectedObjectID])

  const allNodes = useMemo(() => [...builtNodes, ...stickyNodes, ...objectNodes], [builtNodes, stickyNodes, objectNodes])
  const [nodes, setNodes, onNodesChange] = useNodesState(allNodes)
  useEffect(() => {
    // Rebuilt node objects don't carry selected:true, so an unadorned
    // setNodes silently dissolves a live multi-selection on every data
    // refresh -- re-apply it from the ref so a selection survives
    // rebuilds. applyToken sits alongside allNodes, not instead of it:
    // selectObject (goal 0199) needs this to re-fire even when a
    // freshly created object's own arrival didn't itself change
    // allNodes's identity yet.
    const sel = selection.selectedIDsRef.current
    setNodes(sel.length > 0 ? allNodes.map((n) => (sel.includes(n.id) ? { ...n, selected: true } : n)) : allNodes)
  }, [allNodes, setNodes, selection.selectedIDsRef, selection.applyToken])

  useAtlasSelectAll({ cards, notes, objects, setNodes })

  const { trayRef, hasSelection: haveSelection, onGroup: onTrayGroup, onDelete: onTrayDelete } = useAtlasSelectionTray({ selectedCards: selection.selectedCards, selectedNotes: selection.selectedNotes, selectedObjects: selection.selectedObjects, clearSelection: selection.clearSelection, setNodes, onDeleteSelection, onGroupSelection, wrapperRef })

  const minimap = useAtlasMinimapToggle()

  useAtlasKeyboardNav({
    cards, readOnly, wrapperRef,
    cardBoxes: topLevelBoxes, noteBoxes,
    setNodes,
    isGroupCardFn: (card) => isGroupCard(allCards, card),
    onOpenOverlay, onDrill: handleDrill,
    getViewport, setViewport,
  })

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
    void fitView({ minZoom: readOnly ? 1 : undefined, maxZoom: 1, padding: 0.25, duration: reduceMotion ? 0 : 250 })
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

  // The armed tool's own registered descriptor (goal 0215 S2) -- null
  // for nothing armed, or an armed tool with no drag gesture at all
  // (card/note/table/image), same as every other lookup off ATLAS_TOOLS.
  const armedToolDescriptor = creation.armedTool ? (ATLAS_TOOLS.find((t) => t.id === creation.armedTool) ?? null) : null
  // Whether the pane's own panning must stay disabled so the gesture
  // engine's capture-phase trio can own the drag instead (goal 0081 A2)
  // -- shift-drag box-select is unaffected (selectionKeyCode is
  // independent of panOnDrag).
  const anyDragToolArmed = isFree && !readOnly && armedToolDescriptor?.gesture != null

  // Every board object's own rendered flow-space box (goal 0230): read
  // off the live `nodes` state's own `measured` field (React Flow's own
  // ResizeObserver-populated size, the same source AtlasLinkEdge.tsx
  // already reads for floating-edge geometry) rather than
  // BoardObject.Size, which stays null until first resize.
  const objectBoxes = useMemo(() => (
    isFree ? computeObjectBoxes(nodes.filter((n) => n.type === 'atlas-object')) : []
  ), [nodes, isFree])

  const gestureCtx: AtlasGestureCtx = useMemo(() => ({
    screenToFlowPosition,
    parentID,
    cardBoxes: topLevelBoxes,
    noteBoxes,
    objectBoxes,
    onDeleteSelection,
    openAreaPopover: creation.openAreaPopover,
    onShapeCreated: selection.selectObject,
    disarm: creation.disarm,
    disarmUnlessLocked: creation.disarmUnlessLocked,
    hitAccumulator: { cardIDs: new Set(), noteIDs: new Set(), objectIDs: new Set() },
  }), [screenToFlowPosition, parentID, topLevelBoxes, noteBoxes, objectBoxes, onDeleteSelection, creation.openAreaPopover, creation.disarm, creation.disarmUnlessLocked, selection.selectObject])

  const gesture = useAtlasToolGesture({ tool: armedToolDescriptor, readOnly, isFree, ctx: gestureCtx, wrapperRef })

  return (
    <div
      ref={wrapperRef}
      onClickCapture={wrapperClicks.onWrapperClickCapture}
      className={styles.board}
      data-testid="atlas-board"
      data-armed={creation.armedTool !== null}
      data-panning={gesture.panning}
      data-file-drop-target
      data-file-drop-context={FILE_DROP_CONTEXT_BOARD}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(ATLAS_TOOL_DRAG_MIME)) e.preventDefault()
      }}
      onDrop={onCanvasDrop}
      onPointerDownCapture={(e) => {
        selection.snapshotSelection()
        gesture.onPointerDown(e)
      }}
      onPointerMoveCapture={gesture.onPointerMove}
      onPointerUpCapture={gesture.onPointerUp}
    >
      <AtlasDragHighlightContext.Provider value={dragFiling.hoveredFrameID}>
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
        // React Flow's own per-node keyboard accessibility (Escape
        // unselects the FOCUSED node only, Enter/Space toggles it,
        // arrow keys nudge it) is a second, uncoordinated keyboard
        // system layered on top of this board's own (useAtlasKeyboardNav,
        // useAtlasSelectionTray's Escape ladder, each card's own
        // onKeyDown) -- both attached to the same DOM node, both firing
        // on the same keydown. Regression: Escape on a focused,
        // selected card raced RF's own unselect-then-blur ahead of this
        // board's own Escape ladder, so a single press both cleared the
        // selection AND climbed a level, since the ladder's own "was
        // anything selected" read always found RF had already cleared
        // it. Disabled outright -- this board's own hooks are the sole
        // keyboard authority.
        disableKeyboardA11y
        // Goal 0092: NOT default Meta -- that made ⌘-click also toggle.
        multiSelectionKeyCode="Shift"
        nodesDraggable={isFree && !readOnly && !anyDragToolArmed} // an armed draw tool owns the canvas -- nodes are not movable while it is on
        zoomOnDoubleClick={false}
        // Selection must never override OBJECT_Z_INDEX's declared tier
        // (atlasBuildBoardObjectNodes.ts's own comment has the defect).
        elevateNodesOnSelect={false}
        panOnDrag={!anyDragToolArmed}
        // Un-filing (goal 0081 slice A2) means dragging a card TOWARD and past the board's
        // own visible edge, on purpose -- React Flow's own default auto-pan-while-dragging
        // would fight that gesture, sliding the content back under the cursor instead of
        // ever letting it cross the edge.
        autoPanOnNodeDrag={false}
        onSelectionChange={onSelectionChange}
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
          if (node.type === 'atlas-object') {
            onObjectContextMenu(node.id, { x: e.clientX, y: e.clientY })
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
        onPaneClick={wrapperClicks.onPaneClick}
        // Deliberate zoom-out floor everywhere, including narrow
        // viewports: seeing the whole board at once is the surface's
        // core navigation model, and a small screen needs that overview
        // more than a large one, not less. The floor is NOT derived
        // from readOnly -- zoom is navigation, never editing, so being
        // unable to edit a board must not mean being unable to look at
        // it. What narrow viewports DO keep is a floor on the
        // AUTOMATIC fit (fitViewOptions below): a board should never
        // LAND shrunk past every card's real CSS pixel size, since a
        // sub-44px card is an untappable target the user never asked
        // for. Zooming out past that stays a deliberate gesture the
        // user can always reverse.
        minZoom={0.1}
        onNodeDrag={isFree && !readOnly ? dragFiling.onNodeDrag : undefined}
        onNodeDragStop={isFree && !readOnly ? dragFiling.onNodeDragStop : undefined}
        fitView
        fitViewOptions={{ minZoom: readOnly ? 1 : undefined, maxZoom: 1, padding: 0.25, duration: reduceMotion ? 0 : 250 }}
      >
        <AtlasBoardChrome
          kinds={kinds}
          filterPresentKindIDs={filterPresentKindIDs}
          boardFilter={boardFilter}
          onBoardFilterChange={onBoardFilterChange}
          filterMatchCount={filterMatchCount}
          filterTotalCount={filterTotalCount}
          minimapVisible={minimap.visible}
          onMinimapToggle={minimap.toggle}
          refusalHint={slotDrag.refusalHint}
        />
      </ReactFlow>
      </AtlasDragHighlightContext.Provider>
      {/* The armed tool's own gesture.preview (goal 0215 S2), rendered
          generically in this ONE overlay slot -- every drag tool's live
          preview/trail/marquee is a contributed component, not a
          per-tool branch here. */}
      {gesture.Preview && gesture.points.length > 0 && <gesture.Preview points={gesture.points} now={gesture.now} />}
      {slotDrag.dragLine && <AtlasSlotDragLine line={slotDrag.dragLine} />}
      {fileDrop.dropError && <div className={`${styles.dropError} ${runbookStyles.error}`} data-testid="atlas-file-drop-error">{fileDrop.dropError}</div>}
      {fileDrop.dropDuplicateNotice && <div className={styles.dropNotice} data-testid="atlas-file-drop-duplicate-notice">{fileDrop.dropDuplicateNotice}</div>}
      {!readOnly && (haveSelection
        ? <AtlasSelectionTray ref={trayRef} selectedCardCount={selection.selectedCards.length} selectedNoteCount={selection.selectedNotes.length} selectedObjectCount={selection.selectedObjects.length} onGroup={onTrayGroup} onDelete={onTrayDelete} />
        : <AtlasCreationTray armedTool={armedTool.armedToolId} locked={creation.locked} onToggle={creation.toggleArm} tablePickerOpen={tablePicker.open} onTableToggle={tablePicker.setOpen} onClosePickerVisibility={tablePicker.closePickerVisibility} onPickTableSize={(cols, rows) => tablePicker.setPendingSize({ cols, rows })} onTableFromList={onOpenTableFromList} imagePopoverOpen={imagePopover.open} onImageToggle={imagePopover.setOpen} onImageSubmitPath={imageCreate.createFromPath} onImageSubmitFile={imageCreate.createFromFile} />)}
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
  useRenderStormGuard('AtlasBoard')
  return (
    <ReactFlowProvider>
      <AtlasBoardInner {...props} />
    </ReactFlowProvider>
  )
}
