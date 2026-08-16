import { useTranslation } from 'react-i18next'
import { Breadcrumbs } from '@primer/react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { buildBreadcrumbPath, singleRootCard } from './atlasGrouping'

// root -> ... -> current, every ancestor clickable (docs/goals/0061):
// Primer's own Breadcrumbs (frontend.md: adopt a kit component over a
// hand-rolled "a / b / c" strip). The virtual meta level (Card.ParentID
// == "" -- ADR-0038 Decision 3, there is no real root card) only earns
// its own "All spaces" crumb when 2+ root cards actually exist to
// choose between (egocentric-root auto-entry, goal 0069) -- with
// exactly one root card, that card IS the top and the path already
// starts there.
export function AtlasBreadcrumb({ cards, viewedID, onNavigate }: {
  cards: Card[]
  viewedID: string
  onNavigate: (id: string) => void
}) {
  const { t } = useTranslation('atlas')
  const path = buildBreadcrumbPath(cards, viewedID)
  const showMetaCrumb = singleRootCard(cards) === null
  return (
    // The data-testid lives on this wrapper div, not <Breadcrumbs>
    // itself: Breadcrumbs destructures only className/children/style/
    // overflow/variant with no rest-spread, so any other prop (a plain
    // data-testid included) is silently dropped before it ever reaches
    // the DOM -- Breadcrumbs.Item below IS a rest-spread component, so
    // a testid placed directly on an Item would have worked fine.
    <div data-testid="atlas-breadcrumb">
      <Breadcrumbs>
        {showMetaCrumb && (
          <Breadcrumbs.Item
            href="#"
            selected={viewedID === ''}
            onClick={(e) => { e.preventDefault(); onNavigate('') }}
          >
            {t('breadcrumbRoot')}
          </Breadcrumbs.Item>
        )}
        {path.map((card) => (
          <Breadcrumbs.Item
            key={card.ID}
            href="#"
            selected={card.ID === viewedID}
            onClick={(e) => { e.preventDefault(); onNavigate(card.ID) }}
          >
            {card.Title}
          </Breadcrumbs.Item>
        ))}
      </Breadcrumbs>
    </div>
  )
}
