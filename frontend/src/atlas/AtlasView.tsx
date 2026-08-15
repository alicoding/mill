import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Text } from '@primer/react'
import { ViewMode } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Position } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas, useAtlasStore } from './atlasStore'
import { applyLens, childrenOf, groupByKind } from './atlasGrouping'
import { useAtlasDepth } from './useAtlasDepth'
import { AtlasToolbar } from './AtlasToolbar'
import { AtlasShelves } from './AtlasShelves'
import { AtlasCanvasSpace } from './AtlasCanvasSpace'
import { AtlasCardOverlay } from './AtlasCardOverlay'
import { ATLAS_CARD_HEIGHT, ATLAS_CARD_WIDTH } from './atlasCanvasConstants'
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
  const [hiddenKindIDs, setHiddenKindIDs] = useState<string[]>([])
  const [depth, setDepth] = useAtlasDepth(viewedID)
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

  useEffect(() => {
    AtlasService.Lens(viewedID).then((hidden) => setHiddenKindIDs(hidden ?? [])).catch(() => setHiddenKindIDs([]))
  }, [viewedID])

  const allCards = cards ?? []
  const allKinds = kinds ?? []
  const allLinkKinds = linkKinds ?? []
  const allLinks = links ?? []

  const viewedCard = allCards.find((c) => c.ID === viewedID) ?? null
  const effectiveViewMode = viewedCard?.ViewMode === ViewMode.ViewModeCanvas ? ViewMode.ViewModeCanvas : ViewMode.ViewModeShelves
  const childrenAll = childrenOf(allCards, viewedID)
  const presentKinds = groupByKind(childrenAll, allKinds).map((shelf) => shelf.kind)
  const visibleChildren = applyLens(childrenAll, hiddenKindIDs)
  const overlayCard = overlayCardID ? allCards.find((c) => c.ID === overlayCardID) ?? null : null
  const overlayKind = overlayCard ? allKinds.find((k) => k.ID === overlayCard.KindID) : undefined

  const navigate = (id: string) => setViewedID(id)
  const drill = (id: string) => setViewedID(id)
  const openOverlay = (id: string) => setOverlayCardID(id)

  const changeHidden = (hidden: string[]) => {
    setHiddenKindIDs(hidden)
    void AtlasService.SetLens(viewedID, hidden).catch(console.error)
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
      const desired = findFreeDropPosition({ x: 80, y: 80 }, siblings.map((c) => ({ position: { x: c.Position?.X ?? 0, y: c.Position?.Y ?? 0 } })), { width: ATLAS_CARD_WIDTH, height: ATLAS_CARD_HEIGHT })
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
        depth={depth}
        onChangeDepth={setDepth}
        viewMode={effectiveViewMode}
        onChangeViewMode={changeViewMode}
        showViewModeToggle={viewedID !== ''}
        canAddSibling={viewedID !== ''}
        onCreate={createCard}
      />

      {childrenAll.length === 0 ? (
        <div className={styles.emptyState} data-testid="atlas-empty-space">
          <Text as="p" className={runbookStyles.muted}>{t('emptySpace')}</Text>
        </div>
      ) : effectiveViewMode === ViewMode.ViewModeCanvas ? (
        <AtlasCanvasSpace
          cards={visibleChildren}
          allCards={allCards}
          kinds={allKinds}
          peeking={depth === 'peek'}
          onDrill={drill}
          onOpenOverlay={openOverlay}
        />
      ) : (
        <AtlasShelves
          cards={visibleChildren}
          allCards={allCards}
          kinds={allKinds}
          peeking={depth === 'peek'}
          onDrill={drill}
          onOpenOverlay={openOverlay}
        />
      )}

      {overlayCard && (
        <AtlasCardOverlay
          card={overlayCard}
          kind={overlayKind}
          allCards={allCards}
          links={allLinks}
          linkKinds={allLinkKinds}
          onClose={() => setOverlayCardID(null)}
          onSaved={() => void refreshAtlas()}
        />
      )}
    </div>
  )
}
