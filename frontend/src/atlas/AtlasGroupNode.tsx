import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Handle, Position as RFPosition } from '@xyflow/react'
import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { kindColorTokens } from './atlasKindColor'
import type { FreshnessRollup } from './atlasCardPresentation'
import styles from './AtlasGroupNode.module.css'

export interface AtlasGroupData extends Record<string, unknown> {
  card: Card
  kind: Kind | undefined
  childCount: number
  freshness: FreshnessRollup
  onDrill: (id: string) => void
}

export type AtlasGroupRFNode = RFNode<AtlasGroupData>

// A region frame (goal 0072 slice A): a card holding cards, drawn as a
// bordered/tinted frame with its own children rendered as separate
// React Flow nodes on top (parentId + extent:'parent', built by
// AtlasBoard) -- this component renders only the frame's own chrome
// (background/border/header), never the children themselves. The
// header is the ONLY drill affordance in this surface (a group's own
// body never flips, unlike a leaf note card) -- cursor: zoom-in marks
// that on the header alone.
export const AtlasGroupNode = memo(function AtlasGroupNode({ data }: NodeProps<AtlasGroupRFNode>) {
  const { t } = useTranslation('atlas')
  const { card, childCount, freshness, onDrill } = data
  const tokens = kindColorTokens(card.KindID)

  const drill = () => onDrill(card.ID)

  return (
    <div
      className={styles.frame}
      data-testid="atlas-group-card"
      style={{ borderColor: `var(${tokens.fg})`, background: `var(${tokens.muted})` }}
    >
      {/* Invisible connection points, same reasoning as AtlasNoteCardNode's
          own Handle pair -- a link naming this region frame's own card
          as an endpoint needs a real measured Handle to attach to. */}
      <Handle type="target" position={RFPosition.Top} className={styles.handle} />
      <Handle type="source" position={RFPosition.Bottom} className={styles.handle} />
      <div
        className={styles.header}
        data-testid="atlas-group-header"
        role="button"
        tabIndex={0}
        aria-label={t('board.zoomIntoAriaLabel', { title: card.Title })}
        onClick={drill}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            drill()
          }
        }}
      >
        <span className={styles.name}>{card.Title}</span>
        <span className={styles.cardCount}>{t('board.cardsCount', { count: childCount })}</span>
        {freshness.fresh > 0 && (
          <span className={`${styles.pill} ${styles.pillFresh}`} data-testid="atlas-group-fresh-pill">
            {t('board.freshChip', { count: freshness.fresh })}
          </span>
        )}
        {freshness.stale > 0 && (
          <span className={`${styles.pill} ${styles.pillStale}`} data-testid="atlas-group-stale-pill">
            {t('board.staleChip', { count: freshness.stale })}
          </span>
        )}
        <span className={styles.zoomChip}>{t('board.zoomChip')}</span>
      </div>
    </div>
  )
})
