import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, AnchoredOverlay, Breadcrumbs } from '@primer/react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { buildBreadcrumbPath, childrenOf } from './atlasGrouping'

// root -> ... -> current, every ancestor clickable (docs/goals/0061):
// Primer's own Breadcrumbs (frontend.md: adopt a kit component over a
// hand-rolled "a / b / c" strip). The virtual meta level (Card.ParentID
// == "" -- ADR-0038 Decision 3, there is no real root card) renders its
// own "All spaces" crumb UNCONDITIONALLY (goal 0221): a root-level
// board can hold notes/objects alongside a single root card, so the
// meta level is a real, distinct place even with exactly one root card
// -- hiding the crumb there left no visible way out of that card
// (docs/goals/0183 fixed the same-session trap; this closes the
// remaining structural gap: the crumb itself never rendered while
// drilled). The meta crumb stays a plain navigate-on-click link
// (goal 0106 slice B): it names no single real place with siblings of
// its own, unlike every other segment below.
export function AtlasBreadcrumb({ cards, viewedID, onNavigate }: {
  cards: Card[]
  viewedID: string
  onNavigate: (id: string) => void
}) {
  const { t } = useTranslation('atlas')
  const path = buildBreadcrumbPath(cards, viewedID)
  return (
    // The data-testid lives on this wrapper div, not <Breadcrumbs>
    // itself: Breadcrumbs destructures only className/children/style/
    // overflow/variant with no rest-spread, so any other prop (a plain
    // data-testid included) is silently dropped before it ever reaches
    // the DOM -- Breadcrumbs.Item below IS a rest-spread component, so
    // a testid placed directly on an Item would have worked fine.
    <div data-testid="atlas-breadcrumb">
      <Breadcrumbs>
        <Breadcrumbs.Item
          href="#"
          selected={viewedID === ''}
          data-testid="atlas-breadcrumb-root"
          onClick={(e) => { e.preventDefault(); onNavigate('') }}
        >
          {t('breadcrumbRoot')}
        </Breadcrumbs.Item>
        {path.map((card) => (
          <AtlasBreadcrumbSegment key={card.ID} card={card} cards={cards} selected={card.ID === viewedID} onNavigate={onNavigate} />
        ))}
      </Breadcrumbs>
    </div>
  )
}

// Each real segment is a dropdown trigger (goal 0106 slice B contract
// item 5, "structural context" lateral moves): its own place is always
// among the siblings it lists, marked selected -- clicking IT there
// reproduces the crumb's own former direct-navigate-on-click behavior,
// so the menu interposes lateral choice without removing the original
// capability. Siblings share this segment's ParentID -- the same set
// AtlasView's own childrenOf(allCards, viewedID) already computes for
// the board itself, applied one level up the chain here.
function AtlasBreadcrumbSegment({ card, cards, selected, onNavigate }: {
  card: Card
  cards: Card[]
  selected: boolean
  onNavigate: (id: string) => void
}) {
  const { t } = useTranslation('atlas')
  const [open, setOpen] = useState(false)
  const siblings = childrenOf(cards, card.ParentID)

  return (
    <AnchoredOverlay
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      renderAnchor={(anchorProps) => (
        <Breadcrumbs.Item
          {...anchorProps}
          href="#"
          selected={selected}
          data-testid="atlas-breadcrumb-item"
          onClick={(e) => { anchorProps.onClick?.(e); e.preventDefault() }}
        >
          {card.Title}
        </Breadcrumbs.Item>
      )}
      overlayProps={{ 'aria-label': t('breadcrumbSiblingsAriaLabel'), 'data-testid': 'atlas-breadcrumb-siblings' } as never}
    >
      <ActionList selectionVariant="single">
        {siblings.map((sibling) => (
          <ActionList.Item
            key={sibling.ID}
            selected={sibling.ID === card.ID}
            data-testid="atlas-breadcrumb-sibling"
            onSelect={() => { setOpen(false); onNavigate(sibling.ID) }}
          >
            {sibling.Title}
            <ActionList.TrailingVisual>{t('board.cardsCount', { count: childrenOf(cards, sibling.ID).length })}</ActionList.TrailingVisual>
          </ActionList.Item>
        ))}
      </ActionList>
    </AnchoredOverlay>
  )
}
