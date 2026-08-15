import { useTranslation } from 'react-i18next'
import { ActionList, Text } from '@primer/react'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { childrenOf, groupByKind } from './atlasGrouping'
import { AtlasCardBody } from './AtlasCardBody'
import styles from './AtlasShelves.module.css'
import runbookStyles from '../shared/ListCard.module.css'

// Shelves mode (the default, docs/goals/0061): children auto-grouped
// into shelves by Kind, zero manual placement -- Primer's own
// ActionList.Group (frontend.md: "titled, divider-separated sections,
// always fully expanded," exactly shelves' shape) rather than a
// hand-rolled grid of boxed sections.
export function AtlasShelves({ cards, allCards, kinds, peeking, onDrill, onOpenOverlay }: {
  cards: Card[]
  allCards: Card[]
  kinds: Kind[]
  peeking: boolean
  onDrill: (id: string) => void
  onOpenOverlay: (id: string) => void
}) {
  const { t } = useTranslation('atlas')
  const kindByID = new Map(kinds.map((k) => [k.ID, k]))
  const shelves = groupByKind(cards, kinds)

  if (shelves.length === 0) {
    return (
      <div className={styles.empty} data-testid="atlas-shelves-empty">
        <Text as="p" className={runbookStyles.muted}>{t('emptySpace')}</Text>
      </div>
    )
  }

  return (
    <div className={styles.shelves} data-testid="atlas-shelves">
      <ActionList showDividers>
        {shelves.map(({ kind, cards: shelfCards }) => (
          <ActionList.Group key={kind.ID}>
            <ActionList.GroupHeading as="h3">{kind.Icon ? `${kind.Icon} ${kind.Label}` : kind.Label}</ActionList.GroupHeading>
            {shelfCards.map((card) => (
              <ActionList.Item
                key={card.ID}
                data-testid="atlas-shelf-card"
                onSelect={() => onDrill(card.ID)}
              >
                <AtlasCardBody
                  card={card}
                  kind={kindByID.get(card.KindID)}
                  childCount={childrenOf(allCards, card.ID).length}
                  peeking={peeking}
                  onOpenOverlay={() => onOpenOverlay(card.ID)}
                />
              </ActionList.Item>
            ))}
          </ActionList.Group>
        ))}
      </ActionList>
    </div>
  )
}
