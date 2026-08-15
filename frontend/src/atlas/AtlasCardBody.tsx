import { useTranslation } from 'react-i18next'
import { IconButton, Text } from '@primer/react'
import { InfoIcon } from '@primer/octicons-react'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasKindChip } from './AtlasKindChip'
import styles from './AtlasCardBody.module.css'

// The card content every renderer (shelves' ActionList.Item, the canvas
// node view) shows -- kind chip, title, an optional note excerpt, an
// optional peek count (the lens' "peek into children" depth, docs/
// goals/0061), and the ⓘ affordance that opens the full-screen overlay.
// A pure presentational component: the click-to-drill target and drag
// handling stay with each renderer's own outer wrapper, since a
// draggable React Flow node and an ActionList row need different outer
// elements for the same inner content.
export function AtlasCardBody({ card, kind, childCount, peeking, onOpenOverlay }: {
  card: Card
  kind: Kind | undefined
  childCount: number
  peeking: boolean
  onOpenOverlay: () => void
}) {
  const { t } = useTranslation('atlas')
  return (
    <div className={styles.body}>
      <div className={styles.main}>
        <div className={styles.headerRow}>
          <AtlasKindChip kind={kind} />
          {peeking && childCount > 0 && (
            <Text size="small" className={styles.peekCount} data-testid="atlas-peek-count">
              {t('peekCount', { count: childCount })}
            </Text>
          )}
        </div>
        <Text weight="semibold" className={styles.title}>{card.Title}</Text>
        {card.Note && <Text size="small" className={styles.note}>{card.Note}</Text>}
      </div>
      <IconButton
        icon={InfoIcon}
        aria-label={t('openCardDetailsAriaLabel', { title: card.Title })}
        size="small"
        variant="invisible"
        data-testid="atlas-card-info"
        className={`${styles.infoButton} nodrag nopan`}
        onClick={(e) => { e.stopPropagation(); onOpenOverlay() }}
      />
    </div>
  )
}
