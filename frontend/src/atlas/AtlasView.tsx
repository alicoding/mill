import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Text } from '@primer/react'
import { ViewMode } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Card, Position } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import { useUISignalStore } from '../shared/uiSignalStore'
import { downloadJSON } from '../shared/downloadJSON'
import { refreshAtlas, useAtlasStore } from './atlasStore'
import { applyLens, childrenOf, groupByKind, singleRootCard } from './atlasGrouping'
import { useAtlasImportConfirm } from './useAtlasImportConfirm'
import { AtlasToolbar } from './AtlasToolbar'
import { AtlasBoard } from './AtlasBoard'
import type { AtlasFocusRequest } from './AtlasBoard'
import { AtlasJumpDialog } from './AtlasJumpDialog'
import { AtlasCardOverlay } from './AtlasCardOverlay'
import { ContextMenu, type ContextMenuState } from '../shared/ContextMenu'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import { atlasCardShareActions } from './atlasCardShare'
import { AtlasMatrixView } from './AtlasMatrixView'
import { AtlasCoverageView } from './AtlasCoverageView'
import { NOTE_HEIGHT, NOTE_WIDTH, computeGroupFrameLayout, isGroupCard } from './atlasBoardLayout'
import { findFreeDropPosition } from '../shared/canvasLayout'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasView.module.css'

// The Atlas surface's top-level page (docs/adr/0038, docs/goals/0061):
// space rendering (canvas/shelves per the viewed card's
// EffectiveViewMode), drill + explicit breadcrumb-back, the full-screen
// card overlay, the per-space lens, and sibling-vs-child creation.
// Registered in app/App.tsx the same way CompositionView/ConfigureView
// are -- one top-level surface per bounded-context folder.
export function AtlasView({ initialCardID }: { initialCardID?: string }) {
  const { t } = useTranslation('atlas')
  const cards = useAtlasStore((s) => s.cards)
  const kinds = useAtlasStore((s) => s.kinds)
  const linkKinds = useAtlasStore((s) => s.linkKinds)
  const links = useAtlasStore((s) => s.links)

  const [viewedID, setViewedID] = useState('')
  const [overlayCardID, setOverlayCardID] = useState<string | null>(null)
  // A ⌘K jump's one-shot request into whichever board is currently
  // mounted (goal 0072 slice B) -- AtlasBoard clears it via
  // onFocusHandled once its own fly-to-card animation resolves.
  const [focusRequest, setFocusRequest] = useState<AtlasFocusRequest | null>(null)
  // Traceability matrix / coverage (docs/goals/0064): both are viewed-
  // space-scoped dialogs, so a single boolean each is enough state --
  // no card/kind selection needs to survive a close/reopen.
  const [matrixOpen, setMatrixOpen] = useState(false)
  const [coverageOpen, setCoverageOpen] = useState(false)
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

  useEffect(() => {
    void refreshAtlas()
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'atlas') void refreshAtlas()
    })
  }, [])

  useEffect(() => {
    if (consumedInitialCardID.current || !initialCardID || !cards) return
    const target = cards.find((c) => c.ID === initialCardID)
    if (!target) return
    consumedInitialCardID.current = true
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
  useEffect(() => {
    if (initialCardID || !cards || viewedID !== '') return
    const root = singleRootCard(cards)
    if (root) setViewedID(root.ID)
  }, [cards, initialCardID, viewedID])

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

  const allCards = cards ?? []
  const allKinds = kinds ?? []
  const allLinkKinds = linkKinds ?? []
  const allLinks = links ?? []

  const viewedCard = allCards.find((c) => c.ID === viewedID) ?? null
  const effectiveViewMode = viewedCard?.ViewMode === ViewMode.ViewModeCanvas ? ViewMode.ViewModeCanvas : ViewMode.ViewModeShelves
  const childrenAll = childrenOf(allCards, viewedID)
  const presentKinds = groupByKind(childrenAll, allKinds).map((shelf) => shelf.kind)
  // The lens filters cards by KIND, but containment is a ROLE
  // orthogonal to kind (ADR-0038 Decision 3): a card currently
  // holding children renders as a region frame and stays on the board
  // even when its own kind is lens-hidden -- hiding a kind to
  // declutter notes must never remove a whole area and everything
  // previewed inside it.
  const lensed = applyLens(childrenAll, hiddenKindIDs)
  const visibleChildren = childrenAll.filter((c) => lensed.includes(c) || isGroupCard(allCards, c))
  const overlayCard = overlayCardID ? allCards.find((c) => c.ID === overlayCardID) ?? null : null
  const overlayKind = overlayCard ? allKinds.find((k) => k.ID === overlayCard.KindID) : undefined

  // atlas.up (⌘↑, shared/commands.ts): one step up the depth ladder.
  // At the auto-entered single root there is no "up" (the All spaces
  // meta level only exists with 2+ roots) -- the press is a no-op,
  // never a broken empty board.
  const atlasUpRequest = useAppStore((s) => s.atlasUpRequest)
  const lastUpRequest = useRef(atlasUpRequest)
  useEffect(() => {
    if (atlasUpRequest === lastUpRequest.current) return
    lastUpRequest.current = atlasUpRequest
    if (!viewedID) return
    const parent = allCards.find((c) => c.ID === viewedID)?.ParentID ?? ''
    if (parent === '' && singleRootCard(allCards)) return
    setViewedID(parent)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the signal tick alone; viewedID/allCards are read at fire time
  }, [atlasUpRequest])

  // atlas.jump (⌘K, shared/commands.ts): opens AtlasJumpDialog, now
  // purely controlled off this signal (goal 0071's registry
  // surface-precedence reconciliation retired its own capture-phase
  // window listener). Same ref-compared-counter shape as atlasUpRequest
  // above.
  const atlasJumpRequest = useUISignalStore((s) => s.atlasJumpRequest)
  const [jumpOpen, setJumpOpen] = useState(false)
  const lastJumpRequest = useRef(atlasJumpRequest)
  useEffect(() => {
    if (atlasJumpRequest === lastJumpRequest.current) return
    lastJumpRequest.current = atlasJumpRequest
    setJumpOpen(true)
  }, [atlasJumpRequest])

  // atlas.matrix / atlas.coverage (goal 0071 G17): same signal shape,
  // opening the two projection dialogs already owned locally below.
  const atlasMatrixRequest = useUISignalStore((s) => s.atlasMatrixRequest)
  const lastMatrixRequest = useRef(atlasMatrixRequest)
  useEffect(() => {
    if (atlasMatrixRequest === lastMatrixRequest.current) return
    lastMatrixRequest.current = atlasMatrixRequest
    setMatrixOpen(true)
  }, [atlasMatrixRequest])

  const atlasCoverageRequest = useUISignalStore((s) => s.atlasCoverageRequest)
  const lastCoverageRequest = useRef(atlasCoverageRequest)
  useEffect(() => {
    if (atlasCoverageRequest === lastCoverageRequest.current) return
    lastCoverageRequest.current = atlasCoverageRequest
    setCoverageOpen(true)
  }, [atlasCoverageRequest])

  // The card's right-click menu (goal 0075): Open / Zoom in mirror
  // the gesture model's commits; the share trio mirrors the page's
  // meta rail; Delete goes through the same ConfirmDialog contract as
  // every destructive action (frontend.md). Flip is deliberately
  // absent -- a single click IS the flip; a menu item for it would be
  // a longer path to the same glance.
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const { requestDelete, dialog: menuDeleteDialog } = useConfirmDelete<Card>({
    entityType: 'card',
    labelOf: (c) => c.Title,
    onConfirm: (c) => {
      AtlasService.DeleteCard(c.ID).then(() => void refreshAtlas()).catch((err) => setShareError(String(err)))
    },
  })
  const openCardMenu = (cardID: string, pos: { x: number; y: number }) => {
    const card = allCards.find((c) => c.ID === cardID)
    if (!card) return
    const share = atlasCardShareActions(card, (message) => setShareError(message))
    const place = isGroupCard(allCards, card)
    setMenu({
      x: pos.x,
      y: pos.y,
      items: [
        ...(place ? [{ id: 'zoom', label: t('contextMenu.zoomIn'), run: () => drill(card.ID) }] : []),
        { id: 'open', label: t('contextMenu.open'), run: () => setOverlayCardID(card.ID) },
        { id: 'd1', divider: true },
        { id: 'copy-context', label: t('share.copyContext'), run: () => void share.copyAsContext(false) },
        { id: 'copy-link', label: t('share.copyCloudLink'), run: () => void share.copyCloudLink() },
        ...(card.MirrorPath ? [{ id: 'reveal', label: t('share.revealFile'), run: () => void share.revealFile() }] : []),
        { id: 'd2', divider: true },
        { id: 'delete', label: t('overlay.delete'), danger: true, run: () => requestDelete(card) },
      ],
    })
  }

  const navigate = (id: string) => setViewedID(id)
  const drill = (id: string) => setViewedID(id)
  const openOverlay = (id: string) => setOverlayCardID(id)

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
    void AtlasService.SetLens(viewedID, hidden, peek).catch(console.error)
  }

  const changePeek = (nextPeek: boolean) => {
    setPeek(nextPeek)
    void AtlasService.SetLens(viewedID, hiddenKindIDs, nextPeek).catch(console.error)
  }

  const exportAtlas = () => {
    AtlasService.ExportAtlas()
      .then((json) => downloadJSON('atlas.json', json))
      .catch((err) => setImportError(String(err)))
  }

  const runImport = (text: string) => {
    AtlasService.ImportAtlas(text)
      .then(() => { setImportError(null); void refreshAtlas() })
      .catch((err) => setImportError(String(err)))
  }
  const importConfirm = useAtlasImportConfirm({ kinds: allKinds, linkKinds: allLinkKinds, cards: allCards, links: allLinks, onImport: runImport })
  const importFile = (file: File) => {
    file.text().then(importConfirm.requestImport).catch((err) => setImportError(String(err)))
  }

  const changeViewMode = (mode: ViewMode) => {
    if (!viewedID) return
    void AtlasService.SetViewMode(viewedID, mode).then(() => refreshAtlas()).catch(console.error)
  }

  const createCard = async (containment: 'sibling' | 'child', kindID: string, title: string) => {
    const parentID = containment === 'child' ? viewedID : (viewedCard?.ParentID ?? '')
    const targetMode = containment === 'child'
      ? effectiveViewMode
      : (allCards.find((c) => c.ID === parentID)?.ViewMode === ViewMode.ViewModeCanvas ? ViewMode.ViewModeCanvas : ViewMode.ViewModeShelves)
    let position: Position | null = null
    if (targetMode === ViewMode.ViewModeCanvas) {
      const siblings = childrenOf(allCards, parentID).filter((c) => c.Position)
      const desired = findFreeDropPosition(
        { x: 80, y: 80 },
        siblings.map((c) => ({
          position: { x: c.Position?.X ?? 0, y: c.Position?.Y ?? 0 },
          // A sibling that itself holds children renders as a region
          // frame, far larger than a leaf note's own footprint --
          // collision-avoidance must clear its REAL rendered size, not
          // a uniform note-sized box (regression: a new card once
          // landed physically underneath an existing region frame).
          dims: isGroupCard(allCards, c) ? computeGroupFrameLayout(allCards, c.ID).size : { width: NOTE_WIDTH, height: NOTE_HEIGHT },
        })),
        { width: NOTE_WIDTH, height: NOTE_HEIGHT },
      )
      position = { X: desired.x, Y: desired.y }
    }
    await AtlasService.CreateCard(kindID, title, '', {}, parentID, position, ViewMode.$zero, '', '', '')
    await refreshAtlas()
  }

  if (kinds === null || cards === null) {
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
        peek={peek}
        onChangePeek={changePeek}
        viewMode={effectiveViewMode}
        onChangeViewMode={changeViewMode}
        showViewModeToggle={viewedID !== ''}
        canAddSibling={viewedID !== ''}
        onCreate={createCard}
        onExport={exportAtlas}
        onImportFile={importFile}
        onShareError={setShareError}
        onOpenMatrix={() => setMatrixOpen(true)}
        onOpenCoverage={() => setCoverageOpen(true)}
      />

      {importError && <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-import-error">{importError}</Text>}
      {shareError && <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-share-error">{shareError}</Text>}

      {childrenAll.length === 0 ? (
        <div className={styles.emptyState} data-testid="atlas-empty-space">
          <Text as="p" className={runbookStyles.muted}>{t('emptySpace')}</Text>
        </div>
      ) : (
        <AtlasBoard
          cards={visibleChildren}
          allCards={allCards}
          kinds={allKinds}
          links={allLinks}
          linkKinds={allLinkKinds}
          mode={effectiveViewMode}
          viewedID={viewedID}
          focusRequest={focusRequest}
          onDrill={drill}
          onOpenOverlay={openOverlay}
          onCardContextMenu={openCardMenu}
          onFocusHandled={() => setFocusRequest(null)}
        />
      )}

      <AtlasJumpDialog open={jumpOpen} onClose={() => setJumpOpen(false)} cards={allCards} kinds={allKinds} onJump={jumpToCard} />

      {overlayCard && (
        <AtlasCardOverlay
          card={overlayCard}
          kind={overlayKind}
          kinds={allKinds}
          allCards={allCards}
          links={allLinks}
          linkKinds={allLinkKinds}
          onClose={() => setOverlayCardID(null)}
          onSaved={() => void refreshAtlas()}
          onOpenGroupEntry={openGroupEntry}
        />
      )}
      {importConfirm.dialog}
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
      {menuDeleteDialog}

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
    </div>
  )
}
