import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
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
  onDrill: (id: string) => void
}, 'atlas-region-chip'>

// A nested area previewed inside its parent's frame (goal 0073
// semantic zoom): a place within a place, drawn as a compact tinted
// chip -- never a full note card, never its own children. Its one
// affordance is the place's: click/Enter zooms straight in. Invisible
// handles exist only so links can attach (same constraint the note
// card documents).
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
      aria-label={t('board.zoomIntoAriaLabel', { title: data.card.Title })}
      data-testid="atlas-region-chip"
      data-pulse={data.pulsed}
      onClick={() => data.onDrill(data.card.ID)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') data.onDrill(data.card.ID)
      }}
    >
      <Handle type="source" position={Position.Top} className={styles.hiddenHandle} />
      <Handle type="target" position={Position.Top} className={styles.hiddenHandle} />
      <span className={styles.title}>{data.card.Title}</span>
      <span className={styles.count}>{'▸'} {data.childCount}</span>
    </div>
  )
}

export const AtlasRegionChipNode = memo(AtlasRegionChipNodeInner)
