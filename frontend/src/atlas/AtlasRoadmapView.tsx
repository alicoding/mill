import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Dialog, Link as PrimerLink, Text } from '@primer/react'
import { PlusIcon } from '@primer/octicons-react'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { useAtlasQuietToast } from './useAtlasQuietToast'
import {
  buildHorizonKindField, buildRoadmapLanes, cardsEligibleForBucket, effectiveBucketKeyForCard, tagValueForBucketKey,
  HORIZON_BUCKETS, HORIZON_FIELD_KEY, type RoadmapLane,
} from './atlasProjections'
import { kindColorTokens } from './atlasKindColor'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasRoadmapView.module.css'

// The roadmap swimlane view (docs/goals/0212, rides the traceability
// matrix's own precedent -- docs/goals/0064, ADR-0038): rows are the
// viewed space's own Kinds, columns are the horizon tag family (Now/
// Next/Then) plus a trailing Unscheduled catch-all. Hosted exactly
// like AtlasMatrixView -- a Dialog opened from the toolbar, no card/
// kind selection to configure.
//
// The empty state offers the action it names (goal 0225, defect class
// dead-end-instruction): the column structure always renders, each
// Now/Next/Then header carries its own "+ Place cards" picker (reusing
// AtlasPerspectiveMembership's ActionMenu+ActionList idiom), and a chip
// is a native HTML5 drag source between columns -- a plain-dnd escape
// hatch from frontend.md's overlay rule, which governs anchored/floating
// UI, not a drag gesture inside this dialog grid. Drag is an enhancement
// on top of the picker, which already makes every placement reachable
// without it -- no keyboard-only equivalent for the drag path itself.
function RoadmapChip({ card, onOpenCard }: { card: Card; onOpenCard: (id: string) => void }) {
  const tokens = kindColorTokens(card.KindID)
  return (
    <PrimerLink
      as="button"
      type="button"
      className={styles.chip}
      data-testid="atlas-roadmap-chip"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', card.ID)
      }}
      onClick={() => onOpenCard(card.ID)}
    >
      <span className={styles.chipDot} style={{ background: `var(${tokens.emphasis})` }} />
      <span className={styles.chipTitle}>{card.Title}</span>
    </PrimerLink>
  )
}

function RoadmapColumnHeader({ bucketKey, cards, onPlace }: {
  bucketKey: string
  cards: Card[]
  onPlace: (card: Card) => void
}) {
  const { t } = useTranslation('atlas')
  const [open, setOpen] = useState(false)
  const bucket = HORIZON_BUCKETS.find((b) => b.key === bucketKey)
  const eligible = bucket ? cardsEligibleForBucket(cards, bucketKey) : []

  return (
    <div className={styles.headerCell} data-testid="atlas-roadmap-column-header-cell">
      <span data-testid="atlas-roadmap-column-header">{t(`roadmap.bucket.${bucketKey}`)}</span>
      {bucket && (
        <ActionMenu open={open} onOpenChange={setOpen}>
          <ActionMenu.Button
            leadingVisual={PlusIcon}
            size="small"
            variant="invisible"
            data-testid={`atlas-roadmap-place-cards-${bucketKey}`}
          >
            {t('roadmap.placeCards')}
          </ActionMenu.Button>
          <ActionMenu.Overlay maxHeight="medium">
            <ActionList>
              {eligible.length === 0 && (
                <ActionList.Item disabled data-testid="atlas-roadmap-picker-empty">{t('roadmap.pickerEmpty')}</ActionList.Item>
              )}
              {eligible.map((card) => (
                <ActionList.Item
                  key={card.ID}
                  onSelect={() => { setOpen(false); onPlace(card) }}
                  data-testid="atlas-roadmap-picker-item"
                >
                  {card.Title}
                </ActionList.Item>
              ))}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      )}
    </div>
  )
}

function RoadmapLaneRow({ lane, bucketKeys, dragOverBucketKey, onOpenCard, onDragOverBucket, onDragLeaveBucket, onDropOnBucket }: {
  lane: RoadmapLane
  bucketKeys: string[]
  dragOverBucketKey: string | null
  onOpenCard: (id: string) => void
  onDragOverBucket: (bucketKey: string) => void
  onDragLeaveBucket: () => void
  onDropOnBucket: (bucketKey: string, cardID: string) => void
}) {
  return (
    <Fragment>
      <div className={styles.laneLabel} data-testid="atlas-roadmap-lane-label">{lane.laneLabel}</div>
      {lane.cells.map((cell, i) => {
        const bucketKey = bucketKeys[i]
        return (
          <div
            key={i}
            className={`${styles.cell} ${dragOverBucketKey === bucketKey ? styles.cellDragOver : ''}`}
            data-testid="atlas-roadmap-cell"
            data-lane-key={lane.laneKey}
            data-bucket-key={bucketKey}
            onDragOver={(e) => { e.preventDefault(); onDragOverBucket(bucketKey) }}
            onDragLeave={onDragLeaveBucket}
            onDrop={(e) => {
              e.preventDefault()
              const cardID = e.dataTransfer.getData('text/plain')
              onDragLeaveBucket()
              if (cardID) onDropOnBucket(bucketKey, cardID)
            }}
          >
            {cell.length === 0
              ? <Text size="small" className={styles.emptyCell} data-testid="atlas-roadmap-empty-cell">—</Text>
              : cell.map((card) => <RoadmapChip key={card.ID} card={card} onOpenCard={onOpenCard} />)}
          </div>
        )
      })}
    </Fragment>
  )
}

// A single blank row shown when the viewed space has no cards at all --
// the skeleton's own shape still teaches itself with nothing to place
// yet, same "structure over sentence" contract as the tagged case.
function ghostLane(bucketKeys: string[]): RoadmapLane {
  return { laneKey: '__ghost', laneLabel: '', cells: bucketKeys.map(() => []) }
}

export function AtlasRoadmapView({ open, onClose, cards, kinds, onOpenCard }: {
  open: boolean
  onClose: () => void
  cards: Card[]
  kinds: Kind[]
  onOpenCard: (id: string) => void
}) {
  const { t } = useTranslation('atlas')
  const quietToast = useAtlasQuietToast()
  const [dragOverBucketKey, setDragOverBucketKey] = useState<string | null>(null)
  const kindByID = new Map(kinds.map((k) => [k.ID, k]))
  const board = buildRoadmapLanes(cards, (card) => {
    const kind = kindByID.get(card.KindID)
    return { key: card.KindID, label: kind ? (kind.Icon ? `${kind.Icon} ${kind.Label}` : kind.Label) : card.KindID }
  })

  if (!open) return null

  // placeCard writes cardID's horizon field through the same UpdateCard
  // door every card-field edit uses (AtlasCardOverlay's own persist
  // path) -- targetBucketKey's tag value, or '' (clearing the field)
  // for the Unscheduled column. A same-column call is a no-op. A Kind
  // that hasn't declared the field yet gets it added first, additive
  // only (ADR-0040's evolution grammar), announced with a quiet toast
  // so the change stays visible rather than silent.
  const placeCard = (card: Card, targetBucketKey: string) => {
    if (effectiveBucketKeyForCard(card) === targetBucketKey) return
    const targetValue = tagValueForBucketKey(targetBucketKey)
    const kind = kindByID.get(card.KindID)
    const hasField = kind?.Fields?.some((f) => f.Key === HORIZON_FIELD_KEY) ?? false

    const writeCard = () => AtlasService.UpdateCard(
      card.ID, card.Title, card.Note, { ...(card.Fields ?? {}), [HORIZON_FIELD_KEY]: targetValue },
      card.Source, card.MirrorPath, card.RefreshWorkflowID,
    )

    const run = kind && !hasField
      ? AtlasService.UpdateKind(kind.ID, kind.Label, kind.Description, kind.Icon, [...(kind.Fields ?? []), buildHorizonKindField()], null)
        .then(() => {
          quietToast.show(t('roadmap.addedField', { label: kind.Label }))
          return writeCard()
        })
      : writeCard()

    void run.then(() => refreshAtlas())
  }

  const lanesToRender = board.lanes.length > 0 ? board.lanes : [ghostLane(board.bucketKeys)]

  return (
    <Dialog title={t('roadmap.title')} onClose={onClose} width="min(1100px, calc(100vw - 64px))" data-component="atlas-roadmap-dialog">
      {!board.anyTagged && (
        <Text as="p" size="small" className={`${runbookStyles.muted} ${styles.emptyState}`} data-testid="atlas-roadmap-empty">
          {t('roadmap.empty')}
        </Text>
      )}
      <div
        className={styles.grid}
        style={{ gridTemplateColumns: `minmax(140px, auto) repeat(${board.bucketKeys.length}, minmax(160px, 1fr))` }}
        data-testid="atlas-roadmap-grid"
      >
        <div className={styles.headerCell} />
        {board.bucketKeys.map((key) => (
          <RoadmapColumnHeader key={key} bucketKey={key} cards={cards} onPlace={(card) => placeCard(card, key)} />
        ))}
        {lanesToRender.map((lane) => (
          <RoadmapLaneRow
            key={lane.laneKey}
            lane={lane}
            bucketKeys={board.bucketKeys}
            dragOverBucketKey={dragOverBucketKey}
            onOpenCard={onOpenCard}
            onDragOverBucket={setDragOverBucketKey}
            onDragLeaveBucket={() => setDragOverBucketKey(null)}
            onDropOnBucket={(bucketKey, cardID) => {
              const card = cards.find((c) => c.ID === cardID)
              if (card) placeCard(card, bucketKey)
            }}
          />
        ))}
      </div>
      {quietToast.message && (
        // A dialog-local rendering of the same useAtlasQuietToast surface
        // AtlasView's own AtlasQuietToast uses -- that component's CSS
        // pins it a fixed distance above the FULL BOARD's own bottom
        // edge, which lands mid-content in a dialog only a few hundred
        // pixels tall; this stays in normal flow instead.
        <div className={styles.toastBanner} data-testid="atlas-quiet-toast" role="status">
          {quietToast.message}
        </div>
      )}
    </Dialog>
  )
}
