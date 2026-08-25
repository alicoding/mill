import { useEffect, useRef, useState } from 'react'
import { useRenderStormGuard } from '../shared/renderStormGuard'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Text } from '@primer/react'
import { type Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { useAtlasCreationRequests } from './useAtlasCreationRequests'
import { AtlasService } from '../shared/bindings'
import { scheduleAtlasRefresh, refreshAtlas, useAtlasStore } from './atlasStore'
import { applyLens, childrenOf, groupByKind, singleRootCard } from './atlasGrouping'
import { useAtlasPerspectives } from './useAtlasPerspectives'
import { useAtlasSessionLanding } from './useAtlasSessionLanding'
import { useAtlasNavSignals } from './useAtlasNavSignals'
import { useAtlasProjectionViews } from './useAtlasProjectionViews'
import { useAtlasShareIO } from './useAtlasShareIO'
import { AtlasToolbar } from './AtlasToolbar'
import { AtlasBoard } from './AtlasBoard'
import { pasteSummaryText } from './pasteSummary'
import { type AtlasFocusRequest } from './useBoardFocus'
import { type ContextMenuState } from '../shared/ContextMenu'
import { AtlasViewOverlays } from './AtlasViewOverlays'
import { AtlasBoardEmptyState } from './AtlasBoardEmptyState'
import { CompanionPanel } from './CompanionPanel'
import { isGroupCard } from './atlasBoardLayout'
import { useAtlasBoardFilter } from './useAtlasBoardFilter'
import { useAtlasCardCreate } from './useAtlasCardCreate'
import { useAtlasTableObjectCreate } from './useAtlasTableObjectCreate'
import { useAtlasContainmentMenus } from './useAtlasContainmentMenus'
import { useAtlasDeleteConfirm } from './useAtlasDeleteConfirm'
import { useAtlasCommandSignals } from './useAtlasCommandSignals'
import { useAtlasLinkMenus } from './useAtlasLinkMenus'
import { useAtlasNoteMenu } from './useAtlasNoteMenu'
import { useAtlasObjectMenu } from './useAtlasObjectMenu'
import { useAtlasSpaceActions } from './useAtlasSpaceActions'
import { useAtlasUndoToast } from './useAtlasUndoToast'
import { useAtlasUndoJournal } from './useAtlasUndoJournal'
import { AtlasUndoToast } from './AtlasUndoToast'
import { useAtlasQuietToast } from './useAtlasQuietToast'
import { AtlasQuietToast } from './AtlasQuietToast'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasView.module.css'

// The Atlas surface's top-level page (docs/adr/0038, docs/goals/0061):
// space rendering (canvas/shelves per the viewed card's
// EffectiveViewMode), drill + explicit breadcrumb-back, the full-screen
// card overlay, the per-space lens, and sibling-vs-child creation.
// Registered in app/App.tsx the same way CompositionView/ConfigureView
// are -- one top-level surface per bounded-context folder.
export function AtlasView({ initialCardID }: { initialCardID?: string }) {
  useRenderStormGuard('AtlasView')
  const { t } = useTranslation('atlas')
  const cards = useAtlasStore((s) => s.cards)
  const kinds = useAtlasStore((s) => s.kinds)
  const linkKinds = useAtlasStore((s) => s.linkKinds)
  const links = useAtlasStore((s) => s.links)
  const notes = useAtlasStore((s) => s.notes)
  const objects = useAtlasStore((s) => s.objects)
  const perspectives = useAtlasStore((s) => s.perspectives)
  const creationRequests = useAtlasCreationRequests()

  const [viewedID, setViewedID] = useState('')
  const [overlayCardID, setOverlayCardID] = useState<string | null>(null)

  const allCards = cards ?? []
  const allKinds = kinds ?? []
  const allLinkKinds = linkKinds ?? []
  const allLinks = links ?? []
  const allNotes = notes ?? []
  const allObjects = objects ?? []
  const allPerspectives = perspectives ?? []
  // Perspective state + membership filtering (ADR-0041): declared
  // early -- the session-restore effects below need
  // setActivePerspectiveID. The breadcrumb stays on UNFILTERED
  // allCards; ancestry text is never perspective-narrowed.
  const {
    activePerspectiveID, setActivePerspectiveID, boardAllCards, boardLinks,
    switchPerspective, createPerspective, renamePerspective, deletePerspective,
  } = useAtlasPerspectives({ viewedID, allCards, allLinks, allPerspectives })

  // A ⌘K jump's one-shot request into whichever board is currently
  // mounted (goal 0072 slice B) -- AtlasBoard clears it via
  // onFocusHandled once its own fly-to-card animation resolves.
  const [focusRequest, setFocusRequest] = useState<AtlasFocusRequest | null>(null)
  // Arrange-is-an-action (goal 0089): a one-shot request token the
  // board consumes -- the board owns the packer + width, the view owns
  // the toolbar button.
  const [arrangeRequest, setArrangeRequest] = useState(0)
  // Arrange-disabled-while-active (ADR-0041): a global repack while
  // filtered to a perspective's own member set would scramble every
  // OTHER perspective's shared positions. Gated at this single choke
  // point so neither the toolbar button nor the atlas.arrange
  // palette/keyboard command (useAtlasCommandSignals below) can bypass
  // the disabled button.
  const requestAutoArrange = () => {
    if (activePerspectiveID) return
    setArrangeRequest((n) => n + 1)
  }
  const [kindsOpen, setKindsOpen] = useState(false)
  const [hiddenKindIDs, setHiddenKindIDs] = useState<string[]>([])
  // The depth/peek toggle (goal 0061 slice C): server-side now, part of
  // the same per-space Lens AtlasService.SetLens/Lens already persists
  // (absorbed from its previous browser-localStorage home) -- fetched
  // alongside hiddenKindIDs below, in the same effect, since both live
  // in the one Lens record per container.
  const [peek, setPeek] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  // The space toolbar's own share actions (goal 0063) report failures
  // here, separate from importError -- reveal/bundle/copy-links are
  // unrelated to import/export's own error surface.
  const [shareError, setShareError] = useState<string | null>(null)
  // Quick Panel's card-search jump (docs/goals/0061 item 6) supplies a
  // card ID once, at mount -- consumed exactly once (this ref guards
  // against re-applying it on every later data refresh, which would
  // otherwise re-open the overlay even after the user closed it).
  const consumedInitialCardID = useRef(false)
  // State mirror of the ref: the landing gate renders off it, and a
  // ref must not be read during render.
  const [deepLinkConsumed, setDeepLinkConsumed] = useState(false)

  useEffect(() => {
    void refreshAtlas()
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'atlas') scheduleAtlasRefresh()
    })
  }, [])

  useEffect(() => {
    if (consumedInitialCardID.current || !initialCardID || !cards) return
    const target = cards.find((c) => c.ID === initialCardID)
    if (!target) return
    consumedInitialCardID.current = true
    setDeepLinkConsumed(true)
    setViewedID(target.ParentID)
    setOverlayCardID(target.ID)
  }, [initialCardID, cards])

  // Session restore + the egocentric-root auto-entry, split into their
  // own hook (architecture.md's 500-line convention) -- see that
  // hook's own header comment for the full rationale (goals 0091,
  // 0183, 0221).
  const { sessionRestored, suppressAutoEntry, setSuppressAutoEntry } = useAtlasSessionLanding({
    initialCardID, cards, viewedID, setViewedID, overlayCardID, setOverlayCardID,
    activePerspectiveID, setActivePerspectiveID,
  })

  useEffect(() => {
    AtlasService.Lens(viewedID)
      .then((lens) => {
        setHiddenKindIDs(lens?.HiddenKindIDs ?? [])
        setPeek(lens?.Peek ?? false)
      })
      .catch(() => {
        setHiddenKindIDs([])
        setPeek(false)
      })
  }, [viewedID])

  // Never render an interactive board while the mount landing is
  // still pending (session restore in flight, a deep link not yet
  // consumed, or the single-root auto-entry not yet applied): the
  // transient root board LOOKS real, and anything the user -- or a
  // test -- does to it (an Auto-arrange click, a card flip) is
  // consumed by a board that's about to be replaced. While
  // suppressAutoEntry holds, viewedID==="" is a real "All spaces"
  // landing (docs/goals/0183), not a pending one, even with a single
  // root card still in play.
  const landingPending =
    !sessionRestored || !cards ||
    (viewedID === '' && (initialCardID ? !deepLinkConsumed : !suppressAutoEntry && !!singleRootCard(allCards)))

  const viewedCard = allCards.find((c) => c.ID === viewedID) ?? null
  const childrenAll = childrenOf(boardAllCards, viewedID)
  const presentKinds = groupByKind(childrenAll, allKinds).map((shelf) => shelf.kind)
  const { boardFilter, setBoardFilter, filterMatchCount, filterTotalCount, filterPresentKindIDs } = useAtlasBoardFilter(boardAllCards, viewedID)
  // The lens filters cards by KIND, but containment is a ROLE
  // orthogonal to kind (ADR-0038 Decision 3): a card currently
  // holding children renders as a region frame and stays on the board
  // even when its own kind is lens-hidden -- hiding a kind to
  // declutter notes must never remove a whole area and everything
  // previewed inside it.
  const lensed = applyLens(childrenAll, hiddenKindIDs)
  const visibleChildren = childrenAll.filter((c) => lensed.includes(c) || isGroupCard(boardAllCards, c))
  // A note's own containment is spatial-only, orthogonal to the lens
  // (which filters by Kind -- a note has none): every note whose
  // ParentID names the viewed space renders here, unfiltered.
  const visibleNotes = allNotes.filter((n) => n.ParentID === viewedID)
  // A board object's own containment is spatial-only too (goal
  // 0179/0180, the same "containment is location, not meaning" rule
  // notes carry) -- unfiltered by the lens, same reasoning as above.
  const visibleObjects = allObjects.filter((o) => o.ParentID === viewedID)
  const overlayCard = overlayCardID ? allCards.find((c) => c.ID === overlayCardID) ?? null : null

  // navigate/drill mark suppressAutoEntry (docs/goals/0183) exactly
  // when leaving a GENUINELY single-root space for the meta level --
  // the case auto-entry would otherwise reverse. Browsing "All spaces"
  // with 2+ roots (singleRootCard already null there) leaves it false,
  // so a later delete back to one root still auto-resolves into it.
  const navigate = (id: string) => {
    setSuppressAutoEntry(id === '' && viewedID !== '' && singleRootCard(allCards) !== null)
    setViewedID(id)
  }
  const drill = navigate
  // Traceability matrix / coverage / roadmap (docs/goals/0064, 0212):
  // all three are viewed-space-scoped dialogs owned by one shared hook
  // (architecture.md's 500-line convention).
  const projectionViews = useAtlasProjectionViews({ onOpenOverlay: setOverlayCardID })
  const { jumpOpen, setJumpOpen } = useAtlasNavSignals({
    viewedID, allCards, setViewedID: navigate,
    setMatrixOpen: projectionViews.setMatrixOpen, setCoverageOpen: projectionViews.setCoverageOpen, setRoadmapOpen: projectionViews.setRoadmapOpen,
  })

  const openOverlay = (id: string) => setOverlayCardID(id)

  // The card's right-click menu (goal 0075, kind-aware-extended by
  // goal 0081 slice A4): Open / Zoom in mirror the gesture model's
  // commits; the share trio mirrors the page's meta rail; Delete goes
  // through the same ConfirmDialog contract as every destructive
  // action (frontend.md). Flip is deliberately absent -- a single
  // click IS the flip. The edge menu (Change link kind/Edit label/
  // Remove link) lives in the SAME hook -- split out of this file
  // entirely (architecture.md's 500-line convention).
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  // The quick-delete undo toast (goal 0093): one shared instance,
  // fed by every Atlas delete door below -- selection Del/Backspace +
  // tray Delete, card/note context-menu Delete, frame-header Delete,
  // and the card page's own kebab Delete.
  const undoToast = useAtlasUndoToast()
  // A quiet, no-undo toast (membership writes, clipboard feedback).
  const quietToast = useAtlasQuietToast()
  // The board's own ⌘Z/⇧⌘Z journal (goal 0219 S2, ADR-0044) -- an
  // apply-time staleness skip rides the same quiet toast above.
  useAtlasUndoJournal({ onSkip: quietToast.show })
  const [openNoteID, setOpenNoteID] = useState<string | null>(null)

  const deleteConfirm = useAtlasDeleteConfirm({ t, allCards, notes: allNotes })

  const linkMenus = useAtlasLinkMenus({
    t, allCards, allLinks, allNotes, linkKinds: allLinkKinds, perspectives: allPerspectives, setMenu, drill,
    onOpenCard: (id) => setOverlayCardID(id),
    onError: setShareError,
    onDeleted: undoToast.registerDelete,
    onPerspectiveToast: quietToast.show,
    requestLinkedCard: creationRequests.requestLinkedCard, guardDelete: deleteConfirm.guardDelete,
  })

  // onNavigate stays the RAW setViewedID, deliberately not navigate:
  // deleting the space being viewed is a consequence landing at the
  // meta level, not a user choosing to browse it -- it stays eligible
  // to auto-resolve straight back into whatever's left, same as any
  // other viewedID==="" arrival (docs/goals/0183).
  const spaceActions = useAtlasSpaceActions({
    t, viewedCard, guardDelete: deleteConfirm.guardDelete, onDeleted: undoToast.registerDelete, onError: setShareError,
    onOpenOverlay: openOverlay, onNavigate: setViewedID, onNewSpace: () => setNewSpaceOpen(true),
  })

  // The empty-board right-click (goal 0081 A2 rider b):
  // direct-placement doors only -- the
  // dialog-based "Add card…" item is gone (the toolbar's own "+ Add"
  // button still reaches that dialog through its own menu, unrelated
  // to this one). Nothing else fired the old openChildRequest counter
  // this menu item used to bump, so it's gone with it. Space-management
  // items (New space/Rename space/Delete space, docs/goals/0183) come
  // from spaceActions above -- empty unless viewedCard is itself a
  // root-level space.
  const openPaneMenu = (pos: { x: number; y: number }) => {
    setMenu({
      x: pos.x,
      y: pos.y,
      items: [
        { id: 'add-card-here', label: t('contextMenu.addCardHere'), commandId: 'atlas.create.card', run: () => creationRequests.requestPlacement('card', pos) },
        { id: 'add-note-here', label: t('contextMenu.addNoteHere'), commandId: 'atlas.create.note', run: () => creationRequests.requestPlacement('note', pos) },
        ...spaceActions.spaceMenuItems(),
      ],
    })
  }

  const noteMenu = useAtlasNoteMenu({
    t, allNotes, setMenu, onDeleted: undoToast.registerDelete, onError: setShareError,
    requestPromote: creationRequests.requestPromote, onOpenNote: setOpenNoteID,
  })

  const objectMenu = useAtlasObjectMenu({
    t, allObjects, setMenu, onDeleted: undoToast.registerDelete, onError: setShareError,
    requestPromoteObject: creationRequests.requestPromoteObject,
  })

  // Frame/multi-select context menus + their dissolve/delete-with-
  // promotion confirm dialogs (goal 0081 slice A2) -- split into its
  // own hook (architecture.md's 500-line convention); see its own
  // header comment for why the area-draw/drag-filing half stays in
  // AtlasBoard.tsx instead.
  const containmentMenus = useAtlasContainmentMenus({
    t, allCards, notes: allNotes, perspectives: allPerspectives, setMenu, drill, onError: setShareError,
    onDeleted: undoToast.registerDelete,
    onPerspectiveToast: quietToast.show,
    requestPlacementInside: (tool, pos, parentID) => creationRequests.requestPlacement(tool, pos, parentID),
    requestGroup: (cardIDs, noteIDs, pos) => creationRequests.requestGroup(cardIDs, noteIDs, pos), guardDelete: deleteConfirm.guardDelete,
  })

  // ⌘K's GO/OPEN (goal 0072 slice B): a target already rendered (a
  // direct child, or a preview grandchild) flies; anything else
  // re-roots to the target's parent first.
  const jumpToCard = (card: Card, openImmediately: boolean) => {
    const parentIsRenderedChild = allCards.find((c) => c.ID === card.ParentID)?.ParentID === viewedID
    if (card.ParentID !== viewedID && !parentIsRenderedChild) setViewedID(card.ParentID)
    setFocusRequest({ cardID: card.ID, openImmediately })
  }

  // A group entry inside a card's page (goal 0072 slice C item 2):
  // closes the page and reuses the SAME re-root-then-pulse focus
  // plumbing a ⌘K jump uses (jumpToCard above) -- the page itself may
  // be open for a card that isn't the currently viewed board at all
  // (reached via a flip's own Open, or a region frame's new back-face
  // Open, neither of which re-roots), so the target's own parent chain
  // decides whether a re-root is actually needed, exactly like a jump.
  const openGroupEntry = (target: Card) => {
    setOverlayCardID(null)
    jumpToCard(target, false)
  }

  const changeHidden = (hidden: string[]) => {
    setHiddenKindIDs(hidden)
    // peek carries forward whatever the space already had -- its own
    // toggle UI retired with the old Lens popover (consumed by nothing,
    // per docs/SPEC.md's own recorded seam); this is the value's only
    // remaining writer, and it never changes it.
    void AtlasService.SetLens(viewedID, hidden, peek).catch(console.error)
  }

  const { exportAtlas, exportBoardDrawio, importFile, importConfirmDialog } = useAtlasShareIO({ allKinds, allLinkKinds, allCards, allLinks, viewedID, t, onError: setImportError, onSummary: quietToast.show })

  const { createCard } = useAtlasCardCreate({ allCards, viewedID, viewedCard })
  const { createTableFromList, createTableFromScratch } = useAtlasTableObjectCreate({ allCards, viewedID })
  // Goal 0139's two surviving dialogs: the from-a-List projection
  // (reached from the tray picker's footer) and New space (the one
  // create with no canvas to point at).
  const [tableFromListOpen, setTableFromListOpen] = useState(false)
  const [newSpaceOpen, setNewSpaceOpen] = useState(false)

  useAtlasCommandSignals({ viewedID, onArrange: requestAutoArrange, onExport: exportAtlas, onError: setShareError })

  if (kinds === null || cards === null || landingPending) {
    return <Text as="p" className={runbookStyles.muted}>{t('loading')}</Text>
  }

  return (
    <div className={styles.page} data-testid="atlas-view">
      <AtlasToolbar
        cards={allCards}
        viewedID={viewedID}
        onNavigate={navigate}
        kinds={allKinds}
        presentKinds={presentKinds}
        hiddenKindIDs={hiddenKindIDs}
        onChangeHidden={changeHidden}
        onAutoArrange={requestAutoArrange}
        perspectives={allPerspectives}
        activePerspectiveID={activePerspectiveID}
        onSwitchPerspective={switchPerspective}
        onCreatePerspective={createPerspective}
        onRenamePerspective={renamePerspective}
        onDeletePerspective={deletePerspective}
        onPerspectiveToast={quietToast.show}
        links={allLinks}
        linkKinds={allLinkKinds}
        onExport={exportAtlas} onExportDrawio={exportBoardDrawio}
        onImportFile={importFile}
        onShareError={setShareError}
        onOpenMatrix={() => projectionViews.setMatrixOpen(true)}
        onOpenCoverage={() => projectionViews.setCoverageOpen(true)}
        onOpenRoadmap={() => projectionViews.setRoadmapOpen(true)}
        onOpenKinds={() => setKindsOpen(true)}
      />

      {importError && <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-import-error">{importError}</Text>}
      {shareError && <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-share-error">{shareError}</Text>}

      {/* A zero-card zero-note space still renders the board (goal
          0081 slice A2 rider a) -- the empty-state text overlays it,
          non-interactive, so the tray and pane menu stay reachable. */}
      <div className={styles.boardWrapper}>
        {childrenAll.length === 0 && visibleNotes.length === 0 && visibleObjects.length === 0 && (
          <AtlasBoardEmptyState
            filteredByPerspective={activePerspectiveID !== '' && childrenOf(allCards, viewedID).length > 0}
            perspectiveName={allPerspectives.find((pp) => pp.ID === activePerspectiveID)?.Name ?? ''}
            onShowAll={() => switchPerspective('')}
          />
        )}
        <AtlasBoard
          onPasteConverted={(res) => quietToast.show(pasteSummaryText(t, res))}
          onCreateTableSized={(cols, rows, at, parentID) => void createTableFromScratch(cols, rows, at, parentID)}
          onOpenTableFromList={() => setTableFromListOpen(true)}
          boardFilter={boardFilter}
          onBoardFilterChange={setBoardFilter}
          filterMatchCount={filterMatchCount}
          filterTotalCount={filterTotalCount}
          filterPresentKindIDs={filterPresentKindIDs}
          cards={visibleChildren}
          allCards={boardAllCards}
          kinds={allKinds}
          links={boardLinks}
          linkKinds={allLinkKinds}
          notes={visibleNotes}
          allNotes={allNotes}
          objects={visibleObjects}
          parentID={viewedID}
          arrangeRequest={arrangeRequest}
          viewedID={viewedID}
          focusRequest={focusRequest}
          onDrill={drill}
          onOpenOverlay={openOverlay}
          onCardContextMenu={linkMenus.openCardMenu}
          onPaneContextMenu={openPaneMenu}
          onArteryContextMenu={linkMenus.openArteryMenu}
          onEdgeDeleteLink={linkMenus.removeLink}
          onEdgeChangeKind={linkMenus.openChangeKindMenu}
          onNoteContextMenu={noteMenu.openNoteMenu}
          onObjectContextMenu={objectMenu.openObjectMenu}
          onFrameContextMenu={containmentMenus.openFrameMenu}
          onFrameInteriorContextMenu={containmentMenus.openFrameInteriorMenu}
          onMultiSelectContextMenu={containmentMenus.openMultiSelectMenu}
          onDeleteSelection={containmentMenus.deleteSelection}
          onQuietToast={quietToast.show}
          onOpenNote={setOpenNoteID}
          onGroupSelection={(cardIDs, noteIDs, pos) => creationRequests.requestGroup(cardIDs, noteIDs, pos)}
          placementRequest={creationRequests.placementRequest}
          promoteRequest={creationRequests.promoteRequest}
          groupRequest={creationRequests.groupRequest}
          onFocusHandled={() => setFocusRequest(null)}
        />
        {undoToast.pending && (
          <AtlasUndoToast
            count={undoToast.pending.count}
            linksRemoved={undoToast.pending.linksRemoved}
            childrenPromoted={undoToast.pending.childrenPromoted}
            onUndo={undoToast.undo}
          />
        )}
        {quietToast.message && <AtlasQuietToast message={quietToast.message} action={quietToast.action} />}
        <CompanionPanel viewedID={viewedID} />
      </div>

      <AtlasViewOverlays
        jumpOpen={jumpOpen} onCloseJump={() => setJumpOpen(false)} allCards={allCards} allKinds={allKinds} allLinks={allLinks} allLinkKinds={allLinkKinds} jumpToCard={jumpToCard}
        overlayCard={overlayCard} onCloseOverlay={() => setOverlayCardID(null)} undoToast={undoToast} openGroupEntry={openGroupEntry} guardDelete={deleteConfirm.guardDelete}
        importConfirmDialog={importConfirmDialog}
        tableFromListOpen={tableFromListOpen} onCloseTableFromList={() => setTableFromListOpen(false)} newSpaceOpen={newSpaceOpen} onCloseNewSpace={() => setNewSpaceOpen(false)} onCreateTable={createTableFromList} onCreateSpace={(kindID, title) => createCard('sibling', kindID, title)}
        menu={menu} onCloseMenu={() => setMenu(null)} linkMenus={linkMenus} containmentMenus={containmentMenus} deleteConfirm={deleteConfirm}
        openNote={openNoteID ? allNotes.find((n) => n.ID === openNoteID) ?? null : null} onCloseNote={() => setOpenNoteID(null)}
        matrixOpen={projectionViews.matrixOpen} onCloseMatrix={() => projectionViews.setMatrixOpen(false)} coverageOpen={projectionViews.coverageOpen} onCloseCoverage={() => projectionViews.setCoverageOpen(false)} roadmapOpen={projectionViews.roadmapOpen} onCloseRoadmap={() => projectionViews.setRoadmapOpen(false)} childrenAll={childrenAll} kindsOpen={kindsOpen} onCloseKinds={() => setKindsOpen(false)} onOpenCardFromProjection={projectionViews.openCardFromProjection}
      />
    </div>
  )
}
