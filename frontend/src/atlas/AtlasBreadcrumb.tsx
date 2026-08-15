import { useTranslation } from 'react-i18next'
import { Breadcrumbs } from '@primer/react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { buildBreadcrumbPath } from './atlasGrouping'

// root -> ... -> current, every ancestor clickable (docs/goals/0061):
// Primer's own Breadcrumbs (frontend.md: adopt a kit component over a
// hand-rolled "a / b / c" strip). The virtual root (Card.ParentID == ""
// -- ADR-0038 Decision 3, there is no real root card) is always the
// first crumb; its label is app copy, never a seeded card title.
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
          onClick={(e) => { e.preventDefault(); onNavigate('') }}
        >
          {t('breadcrumbRoot')}
        </Breadcrumbs.Item>
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
