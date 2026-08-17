import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import { ArrowUpRightIcon } from '@primer/octicons-react'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { kindColorTokens } from './atlasKindColor'
import styles from './AtlasRegionChipNode.module.css'

export type AtlasRegionChipRFNode = Node<{
  card: Card
  kind: Kind | undefined
  childCount: number
  // A jump/entry landing on this chip (same meaning as the note
  // card's own pulsed) -- attention needs a visible answer even when
  // the target renders as a place.
  pulsed: boolean
  // Shares AtlasBoard's one-flipped-at-a-time state with notes and
  // frames (goal 0074: click glances EVERYWHERE, chips included).
  flipped: boolean
  onToggleFlip: (id: string) => void
  onOpenOverlay: (id: string) => void
  onDrill: (id: string) => void
}, 'atlas-region-chip'>

// A nested area previewed inside its parent's frame (goal 0073
// semantic zoom): a place within a place, drawn as a compact tinted
// chip -- never a full note card, never its own children. Gestures
// follow the uniform model (goal 0074): click flips to a minimal back
// (kind eyebrow, card count, Open), double-click commits -- a place's
// commit is zooming in. Invisible handles exist only so links can
// attach (same constraint the note card documents).
function AtlasRegionChipNodeInner({ data }: NodeProps<AtlasRegionChipRFNode>) {
  const { t } = useTranslation('atlas')
  const tokens = kindColorTokens(data.card.KindID)

  return (
    <div
      className={styles.chip}
      style={{
        borderColor: `var(${tokens.emphasis})`,
        background: `var(${tokens.muted})`,
      }}
      role="button"
      tabIndex={0}
      aria-label={t('board.flipCardAriaLabel', { title: data.card.Title })}
      data-testid="atlas-region-chip"
      data-pulse={data.pulsed}
      data-flipped={data.flipped}
      onClick={(e) => {
        // Shift-click is selection (goal 0092) -- never also a flip.
        if (e.shiftKey) return
        if (e.metaKey || e.ctrlKey) data.onOpenOverlay(data.card.ID)
        else data.onToggleFlip(data.card.ID)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        data.onDrill(data.card.ID)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          data.onToggleFlip(data.card.ID)
        }
      }}
    >
      <Handle type="source" position={Position.Top} className={styles.hiddenHandle} />
      <Handle type="target" position={Position.Top} className={styles.hiddenHandle} />
      <div className={styles.flipInner} data-flipped={data.flipped}>
        <div className={styles.face} data-testid="atlas-region-chip-front">
          <span className={styles.title}>{data.card.Title}</span>
          <span className={styles.count}>{'▸'} {data.childCount}</span>
        </div>
        <div className={`${styles.face} ${styles.backFace}`} data-testid="atlas-region-chip-back">
          <span className={styles.backEyebrow}>{t('board.flipSideEyebrow', { kind: data.kind?.Label ?? '' })}</span>
          <span className={styles.count}>{t('page.cardsChip', { count: data.childCount })}</span>
          <button
            type="button"
            className={`${styles.openButton} nodrag nopan`}
            data-testid="atlas-region-chip-open"
            onClick={(e) => {
              e.stopPropagation()
              data.onOpenOverlay(data.card.ID)
            }}
          >
            {t('board.open')}
            <ArrowUpRightIcon size={10} />
          </button>
        </div>
      </div>
    </div>
  )
}

export const AtlasRegionChipNode = memo(AtlasRegionChipNodeInner)
