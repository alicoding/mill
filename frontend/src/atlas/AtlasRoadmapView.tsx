import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Link as PrimerLink, Text } from '@primer/react'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { buildRoadmapLanes, type RoadmapLane } from './atlasProjections'
import { kindColorTokens } from './atlasKindColor'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasRoadmapView.module.css'

// The roadmap swimlane view (docs/goals/0212, rides the traceability
// matrix's own precedent -- docs/goals/0064, ADR-0038): rows are the
// viewed space's own Kinds, columns are the horizon tag family (Now/
// Next/Then) plus a trailing Unscheduled catch-all. Hosted exactly
// like AtlasMatrixView -- a Dialog opened from the toolbar, no card/
// kind selection to configure. View-only v1: a chip's own click opens
// the card, nothing here edits a tag or drags a card between columns.
function RoadmapChip({ card, onOpenCard }: { card: Card; onOpenCard: (id: string) => void }) {
  const tokens = kindColorTokens(card.KindID)
  return (
    <PrimerLink
      as="button"
      type="button"
      className={styles.chip}
      data-testid="atlas-roadmap-chip"
      onClick={() => onOpenCard(card.ID)}
    >
      <span className={styles.chipDot} style={{ background: `var(${tokens.emphasis})` }} />
      <span className={styles.chipTitle}>{card.Title}</span>
    </PrimerLink>
  )
}

function RoadmapLaneRow({ lane, onOpenCard }: { lane: RoadmapLane; onOpenCard: (id: string) => void }) {
  return (
    <Fragment>
      <div className={styles.laneLabel} data-testid="atlas-roadmap-lane-label">{lane.laneLabel}</div>
      {lane.cells.map((cell, i) => (
        <div key={i} className={styles.cell} data-testid="atlas-roadmap-cell">
          {cell.length === 0
            ? <Text size="small" className={styles.emptyCell} data-testid="atlas-roadmap-empty-cell">—</Text>
            : cell.map((card) => <RoadmapChip key={card.ID} card={card} onOpenCard={onOpenCard} />)}
        </div>
      ))}
    </Fragment>
  )
}

export function AtlasRoadmapView({ open, onClose, cards, kinds, onOpenCard }: {
  open: boolean
  onClose: () => void
  cards: Card[]
  kinds: Kind[]
  onOpenCard: (id: string) => void
}) {
  const { t } = useTranslation('atlas')
  const kindByID = new Map(kinds.map((k) => [k.ID, k]))
  const board = buildRoadmapLanes(cards, (card) => {
    const kind = kindByID.get(card.KindID)
    return { key: card.KindID, label: kind ? (kind.Icon ? `${kind.Icon} ${kind.Label}` : kind.Label) : card.KindID }
  })

  if (!open) return null

  return (
    <Dialog title={t('roadmap.title')} onClose={onClose} width="min(1100px, calc(100vw - 64px))" data-component="atlas-roadmap-dialog">
      {!board.anyTagged ? (
        <Text as="p" size="small" className={`${runbookStyles.muted} ${styles.emptyState}`} data-testid="atlas-roadmap-empty">
          {t('roadmap.empty')}
        </Text>
      ) : (
        <div
          className={styles.grid}
          style={{ gridTemplateColumns: `minmax(140px, auto) repeat(${board.bucketKeys.length}, minmax(160px, 1fr))` }}
          data-testid="atlas-roadmap-grid"
        >
          <div className={styles.headerCell} />
          {board.bucketKeys.map((key) => (
            <div key={key} className={styles.headerCell} data-testid="atlas-roadmap-column-header">
              {t(`roadmap.bucket.${key}`)}
            </div>
          ))}
          {board.lanes.map((lane) => (
            <RoadmapLaneRow key={lane.laneKey} lane={lane} onOpenCard={onOpenCard} />
          ))}
        </div>
      )}
    </Dialog>
  )
}
