import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useRenderStormGuard } from '../shared/renderStormGuard'
import { useTranslation } from 'react-i18next'
import { ReactFlow, ReactFlowProvider, useNodesState, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AtlasService } from '../shared/bindings'
import { useIsNarrowViewport } from '../shared/useNarrowViewport'
import { usePrefersReducedMotion } from '../shared/usePrefersReducedMotion'
import { computeGroupFrameLayout, isGroupCard } from './atlasBoardLayout'
import { computeNoteBoxes, computeTopLevelBoxes } from './atlasBoardBoxes'
import { rfEdgeTypes, rfNodeTypes } from './atlasBoardNodeTypes'
import { AtlasBoardChrome } from './AtlasBoardChrome'
import { resolveBoardEdges } from './atlasLinkResolution'
import { useAtlasArrange } from './useAtlasArrange'
import { useAtlasEdgeInteraction } from './useAtlasEdgeInteraction'
import { useBoardFocus } from './useBoardFocus'
import { useAtlasCreation } from './useAtlasCreation'
import { useAtlasAreaDraw } from './useAtlasAreaDraw'
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
import { AtlasCreationTray, ATLAS_TOOL_DRAG_MIME, type AtlasCreationTool } from './AtlasCreationTray'
import { useTablePickerSignal } from './useTablePickerSignal'
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
function AtlasBoardInner({ boardFilter, onBoardFilterChange, filterMatchCount, filterTotalCount, filterPresentKindIDs, cards, allCards, kinds, links, linkKinds, notes, allNotes, parentID, arrangeRequest, viewedID, focusRequest, onDrill, onOpenOverlay, onFocusHandled, onCardContextMenu, onPaneContextMenu, onArteryContextMenu, onEdgeDeleteLink, onEdgeChangeKind, onNoteContextMenu, onFrameContextMenu, onFrameInteriorContextMenu, onMultiSelectContextMenu, onDeleteSelection, onGroupSelection, onPasteConverted, onCreateTableSized, onOpenTableFromList, onQuietToast, onOpenNote, placementRequest, promoteRequest, groupRequest }: AtlasBoardInnerProps) {
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

  // Free-mode overlap resolution (goal 0073, the growth class): a
  // frame's size is DERIVED from its children, so a clear layout can
  // start overlapping with nobody having moved a card. Resolved with
  // a deterministic minimal-displacement separation
  // (atlasOverlapResolution) and PERSISTED below, so the nudge is
  // stable across reloads. Leaf-on-leaf overlaps stay hand placement.
  // Auto-arrange rows wrap at the board's real width; the layout
  // constant is the floor so a narrow pane still wraps.
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

  const tablePicker = useTablePickerSignal()
  const creation = useAtlasCreation({ parentID, allCards, kinds, notes, readOnly, screenToFlowPosition, placementRequest, promoteRequest, groupRequest, cardBoxes: topLevelBoxes, noteBoxes })
  const selection = useAtlasSelection({ cards, notes, onMultiSelectContextMenu })
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
      if (cardIDs.length + noteIDs.length > 0) onDeleteSelection(cardIDs, noteIDs)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cards, notes, onDeleteSelection, selection.selectedIDsRef])

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
  useAtlasPaste({ topLevelBoxes, screenToFlowPosition, onPasteText: creation.openPasteText, viewedID, onPasteConverted })
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

  const { trayRef, hasSelection: haveSelection, onGroup: onTrayGroup, onDelete: onTrayDelete } = useAtlasSelectionTray({ selectedCards: selection.selectedCards, selectedNotes: selection.selectedNotes, clearSelection: selection.clearSelection, setNodes, onDeleteSelection, onGroupSelection, wrapperRef })

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

  // Area drawing's own armed state (goal 0081 slice A2) disables the
  // pane's panning so the mousedown/move/up trio below can own the
  // drag -- shift-drag box-select is unaffected (RF's own
  // selectionKeyCode handling is independent of panOnDrag).
  const areaArmed = isFree && !readOnly && creation.armedTool === 'area'

  const r = areaDraw.dragLocalRect, marqueeStyle = r ? { left: r.x, top: r.y, width: r.width, height: r.height } : null

  return (
    <div
      ref={wrapperRef}
      onClickCapture={wrapperClicks.onWrapperClickCapture}
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
        nodesDraggable={isFree && !readOnly}
        zoomOnDoubleClick={false}
        panOnDrag={!areaArmed}
        // Un-filing (goal 0081 slice A2) means dragging a card TOWARD
        // and past the board's own visible edge, on purpose -- React
        // Flow's own default auto-pan-while-dragging would fight that
        // gesture, sliding the content back under the cursor instead
        // of ever letting it cross the edge.
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
      {marqueeStyle && <div className={styles.marquee} data-testid="atlas-area-marquee" style={marqueeStyle} />}
      {slotDrag.dragLine && <AtlasSlotDragLine line={slotDrag.dragLine} />}
      {fileDrop.dropError && <div className={`${styles.dropError} ${runbookStyles.error}`} data-testid="atlas-file-drop-error">{fileDrop.dropError}</div>}
      {fileDrop.dropDuplicateNotice && <div className={styles.dropNotice} data-testid="atlas-file-drop-duplicate-notice">{fileDrop.dropDuplicateNotice}</div>}
      {!readOnly && (haveSelection
        ? <AtlasSelectionTray ref={trayRef} selectedCardCount={selection.selectedCards.length} selectedNoteCount={selection.selectedNotes.length} onGroup={onTrayGroup} onDelete={onTrayDelete} />
        : <AtlasCreationTray armedTool={creation.armedTool} onToggle={creation.toggleArm} tablePickerOpen={tablePicker.open || tablePicker.pendingSize !== null} onTableToggle={tablePicker.setOpen} onPickTableSize={(cols, rows) => tablePicker.setPendingSize({ cols, rows })} onTableFromList={onOpenTableFromList} />)}
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
