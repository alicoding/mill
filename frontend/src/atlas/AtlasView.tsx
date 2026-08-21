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
import { useAtlasNavSignals } from './useAtlasNavSignals'
import { useAtlasShareIO } from './useAtlasShareIO'
import { AtlasToolbar } from './AtlasToolbar'
import { AtlasBoard } from './AtlasBoard'
import { pasteSummaryText } from './pasteSummary'
import { AtlasStructureDialogs } from './AtlasStructureDialogs'
import { type AtlasFocusRequest } from './useBoardFocus'
import { AtlasJumpDialog } from './AtlasJumpDialog'
import { AtlasCardOverlay } from './AtlasCardOverlay'
import { ContextMenu, type ContextMenuState } from '../shared/ContextMenu'
import { AtlasMatrixView } from './AtlasMatrixView'
import { AtlasCoverageView } from './AtlasCoverageView'
import { AtlasKindManager } from './AtlasKindManager'
import { AtlasBoardEmptyState } from './AtlasBoardEmptyState'
import { isGroupCard } from './atlasBoardLayout'
import { useAtlasBoardFilter } from './useAtlasBoardFilter'
import { useAtlasCardCreate } from './useAtlasCardCreate'
import { useAtlasContainmentMenus } from './useAtlasContainmentMenus'
import { useAtlasCommandSignals } from './useAtlasCommandSignals'
import { useAtlasLinkMenus } from './useAtlasLinkMenus'
import { useAtlasNoteMenu } from './useAtlasNoteMenu'
import { useAtlasUndoToast } from './useAtlasUndoToast'
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
  const perspectives = useAtlasStore((s) => s.perspectives)
  const creationRequests = useAtlasCreationRequests()

  const [viewedID, setViewedID] = useState('')
  const [overlayCardID, setOverlayCardID] = useState<string | null>(null)

  const allCards = cards ?? []
  const allKinds = kinds ?? []
  const allLinkKinds = linkKinds ?? []
  const allLinks = links ?? []
  const allNotes = notes ?? []
  const allPerspectives = perspectives ?? []
  // Board-scoped perspective state + membership filtering (ADR-0041,
  // goal 0095 slice 2) -- see useAtlasPerspectives.ts's own header
  // comment. Declared early (ahead of the session-restore effects
  // below, which need setActivePerspectiveID) rather than grouped with
  // the other `allX` derivations further down. The breadcrumb
  // (AtlasToolbar's own `cards` prop below) stays on the UNFILTERED
  // allCards -- ancestry text is never perspective-narrowed.
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
  // Traceability matrix / coverage (docs/goals/0064): both are viewed-
  // space-scoped dialogs, so a single boolean each is enough state --
  // no card/kind selection needs to survive a close/reopen.
  const [matrixOpen, setMatrixOpen] = useState(false)
  const [coverageOpen, setCoverageOpen] = useState(false)
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

  // The egocentric-root auto-entry (ADR-0038): with
  // exactly one root card (ParentID==="") the meta "All spaces" level
  // never exists (AtlasBreadcrumb's own singleRootCard check hides its
  // crumb) -- so viewedID=="" is never a real resting state in that
  // world, only a transient one (before the first fetch resolves, or
  // right after a second root card is deleted back down to one).
  // Always resolving it rather than a one-shot effect keeps both cases
  // correct without special-casing which one is happening. Skipped
  // entirely once a deep link has claimed the initial navigation --
  // that flow's own viewedID=="" (a root-level target's own space) is
  // a deliberate destination, not a state to redirect away from.
  // Session restore (goal 0091): land where you stood -- one-shot on
  // mount, before the single-root redirect can claim the landing. The
  // service already degrades stale ids (deleted viewed card -> root,
  // deleted open card -> dropped), so what arrives here is always
  // renderable. Saves below stay gated until this resolves, so the
  // mount's own transient '' never clobbers the persisted state.
  // Resolution must be STATE, not only a ref: the single-root landing
  // below waits for it, and a ref flip alone would never re-run that
  // effect -- the view would sit at "All spaces" until some unrelated
  // cards refresh finally re-fired it (mid-interaction jump).
  const sessionRestoreClaimed = useRef(false)
  const [sessionRestored, setSessionRestored] = useState(false)
  useEffect(() => {
    if (sessionRestoreClaimed.current) return
    sessionRestoreClaimed.current = true
    // A deep link owns the landing -- restore yields entirely (but
    // saves still arm, so the deep-linked position persists next).
    if (initialCardID) { setSessionRestored(true); return }
    AtlasService.AtlasSession()
      .then((session) => {
        if (session?.viewedID) setViewedID(session.viewedID)
        if (session?.openCardID) setOverlayCardID(session.openCardID)
        if (session?.activePerspectiveID) setActivePerspectiveID(session.activePerspectiveID)
      })
      .finally(() => setSessionRestored(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount landing, same as the deep-link claim
  }, [])
  useEffect(() => {
    if (!sessionRestored) return
    void AtlasService.SetAtlasSession({ viewedID, openCardID: overlayCardID ?? '', activePerspectiveID }).catch(() => {})
  }, [sessionRestored, viewedID, overlayCardID, activePerspectiveID])

  useEffect(() => {
    if (initialCardID || !cards || viewedID !== '' || !sessionRestored) return
    const root = singleRootCard(cards)
    if (root) setViewedID(root.ID)
  }, [cards, initialCardID, viewedID, sessionRestored])

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
  // consumed by a board that's about to be replaced.
  const landingPending =
    !sessionRestored || !cards ||
    (viewedID === '' && (initialCardID ? !deepLinkConsumed : !!singleRootCard(allCards)))

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
  const overlayCard = overlayCardID ? allCards.find((c) => c.ID === overlayCardID) ?? null : null

  const { jumpOpen, setJumpOpen } = useAtlasNavSignals({ viewedID, allCards, setViewedID, setMatrixOpen, setCoverageOpen })

  const navigate = (id: string) => setViewedID(id)
  const drill = (id: string) => setViewedID(id)
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
  // A quiet, no-undo toast for membership add/remove and a perspective-
  // service refusal (ADR-0041) -- switching itself shows no toast, only
  // a membership WRITE does.
  const quietToast = useAtlasQuietToast()

  const linkMenus = useAtlasLinkMenus({
    t, allCards, allLinks, allNotes, linkKinds: allLinkKinds, perspectives: allPerspectives, setMenu, drill,
    onOpenCard: (id) => setOverlayCardID(id),
    onError: setShareError,
    onDeleted: undoToast.registerDelete,
    onPerspectiveToast: quietToast.show,
    requestLinkedCard: creationRequests.requestLinkedCard,
  })

  // The empty-board right-click (goal 0075's audit G3, superseded by
  // goal 0081 slice A2's rider b): direct-placement doors only -- the
  // dialog-based "Add card…" item is gone (the toolbar's own "+ Add"
  // button still reaches that dialog through its own menu, unrelated
  // to this one). Nothing else fired the old openChildRequest counter
  // this menu item used to bump, so it's gone with it.
  const openPaneMenu = (pos: { x: number; y: number }) => {
    setMenu({
      x: pos.x,
      y: pos.y,
      items: [
        { id: 'add-card-here', label: t('contextMenu.addCardHere'), commandId: 'atlas.create.card', run: () => creationRequests.requestPlacement('card', pos) },
        // A second ROOT (goal 0139): only offered while viewing a
        // root-level board -- the one create placement can't express.
        ...(viewedCard && viewedCard.ParentID === '' ? [{ id: 'new-space', label: t('contextMenu.newSpace'), run: () => setNewSpaceOpen(true) }] : []),
        { id: 'add-note-here', label: t('contextMenu.addNoteHere'), commandId: 'atlas.create.note', run: () => creationRequests.requestPlacement('note', pos) },
      ],
    })
  }

  const noteMenu = useAtlasNoteMenu({
    t, allNotes, setMenu, onDeleted: undoToast.registerDelete, onError: setShareError,
    requestPromote: creationRequests.requestPromote,
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
    requestGroup: (cardIDs, noteIDs, pos) => creationRequests.requestGroup(cardIDs, noteIDs, pos),
  })

  // ⌘K's GO/OPEN (goal 0072 slice B): a target is already rendered on
  // the current board either as one of its direct children, or --
  // AtlasBoard's own one-nesting-level-deep group preview -- as a
  // grandchild whose parent is itself a rendered child. Anything else
  // needs a re-root to the target's own parent before AtlasBoard can
  // fly to it.
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

  // The matrix/coverage dialogs' own "click a target/missing card"
  // action -- closes whichever projection dialog is open first, so the
  // overlay never renders stacked behind it.
  const openCardFromProjection = (id: string) => {
    setMatrixOpen(false)
    setCoverageOpen(false)
    setOverlayCardID(id)
  }

  const changeHidden = (hidden: string[]) => {
    setHiddenKindIDs(hidden)
    // peek carries forward whatever the space already had -- its own
    // toggle UI retired with the old Lens popover (consumed by nothing,
    // per docs/SPEC.md's own recorded seam); this is the value's only
    // remaining writer, and it never changes it.
    void AtlasService.SetLens(viewedID, hidden, peek).catch(console.error)
  }

  const { exportAtlas, importFile, importConfirmDialog } = useAtlasShareIO({ allKinds, allLinkKinds, allCards, allLinks, onError: setImportError })

  const { createCard, createTableCard, createTableFromScratch } = useAtlasCardCreate({ allCards, viewedID, viewedCard })
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
        onExport={exportAtlas}
        onImportFile={importFile}
        onShareError={setShareError}
        onOpenMatrix={() => setMatrixOpen(true)}
        onOpenCoverage={() => setCoverageOpen(true)}
        onOpenKinds={() => setKindsOpen(true)}
      />

      {importError && <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-import-error">{importError}</Text>}
      {shareError && <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-share-error">{shareError}</Text>}

      {/* A zero-card zero-note space still renders the board (goal
          0081 slice A2 rider a) -- the empty-state text overlays it,
          non-interactive, so the tray and pane menu stay reachable. */}
      <div className={styles.boardWrapper}>
        {childrenAll.length === 0 && visibleNotes.length === 0 && (
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
          onFrameContextMenu={containmentMenus.openFrameMenu}
          onFrameInteriorContextMenu={containmentMenus.openFrameInteriorMenu}
          onMultiSelectContextMenu={containmentMenus.openMultiSelectMenu}
          onDeleteSelection={containmentMenus.deleteSelection}
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
        {quietToast.message && <AtlasQuietToast message={quietToast.message} />}
      </div>

      <AtlasJumpDialog open={jumpOpen} onClose={() => setJumpOpen(false)} cards={allCards} kinds={allKinds} onJump={jumpToCard} />

      {overlayCard && (
        <AtlasCardOverlay
          card={overlayCard}
          kinds={allKinds}
          allCards={allCards}
          links={allLinks}
          linkKinds={allLinkKinds}
          onClose={() => setOverlayCardID(null)}
          onSaved={() => void refreshAtlas()}
          onDeleted={undoToast.registerDelete}
          onOpenGroupEntry={openGroupEntry}
        />
      )}
      {importConfirmDialog}
      <AtlasStructureDialogs kinds={allKinds} tableFromListOpen={tableFromListOpen} onCloseTableFromList={() => setTableFromListOpen(false)} newSpaceOpen={newSpaceOpen} onCloseNewSpace={() => setNewSpaceOpen(false)} onCreateTable={createTableCard} onCreateSpace={(k, title) => createCard('sibling', k, title)} />
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
      {linkMenus.labelPopover}
      {containmentMenus.dissolveDialog}

      <AtlasMatrixView
        open={matrixOpen}
        onClose={() => setMatrixOpen(false)}
        cards={childrenAll}
        kinds={allKinds}
        links={allLinks}
        linkKinds={allLinkKinds}
        onOpenCard={openCardFromProjection}
      />
      <AtlasCoverageView
        open={coverageOpen}
        onClose={() => setCoverageOpen(false)}
        cards={childrenAll}
        links={allLinks}
        linkKinds={allLinkKinds}
        onOpenCard={openCardFromProjection}
      />
      <AtlasKindManager
        open={kindsOpen}
        onClose={() => setKindsOpen(false)}
        kinds={allKinds}
        linkKinds={allLinkKinds}
      />
    </div>
  )
}
