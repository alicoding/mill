import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Handle, NodeResizer, Position as RFPosition } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { AtlasService } from '../shared/bindings'
import { AtlasCardProjectionTable } from './AtlasCardProjectionTable'
import type { AtlasNoteCardRFNode } from './AtlasNoteCardNode'
import noteStyles from './AtlasNoteCardNode.module.css'
import styles from './AtlasTableCardNode.module.css'

// The List → table projection's board face (goal 0105): the note
// card's header/click-model with the live table as its body. Rendered
// only in FREE placement mode -- auto-arrange packs uniform note
// boxes, so there the same card shows its note face with a table chip
// (atlasBuildBoardNodes; per-size-aware auto layout is the named
// revisit if the summary face proves insufficient).
export const AtlasTableCardNode = memo(function AtlasTableCardNode({ data, selected }: NodeProps<AtlasNoteCardRFNode>) {
  const { t } = useTranslation('atlas')
  const { card, pulsed, isSoleSelected, onCommit } = data

  return (
    <div
      className={styles.card}
      data-testid="atlas-table-card"
      data-pulse={pulsed}
      data-dimmed={data.dimmed}
      role="button"
      tabIndex={0}
      aria-label={t('board.cardAriaLabel', { title: card.Title })}
      onClick={(e) => {
        if (e.shiftKey) return
        if (e.metaKey || e.ctrlKey) { onCommit(card.ID); return }
        if (isSoleSelected(card.ID)) onCommit(card.ID)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onCommit(card.ID)
        }
      }}
    >
      {/* Resize persists as Card.Size -- the canvas library's own
          resizer (frontend.md's overlay/interaction rule), shown only
          while selected so the face stays quiet at rest. */}
      <NodeResizer
        isVisible={selected ?? false}
        minWidth={280}
        minHeight={160}
        onResizeEnd={(_e, params) => {
          void AtlasService.SetCardSize(card.ID, params.width, params.height)
        }}
      />
      <Handle type="target" position={RFPosition.Top} className={noteStyles.handle} />
      <Handle type="source" position={RFPosition.Bottom} className={noteStyles.handle} />
      {/* No kind chip on the table face (goal 0137): the table's
          meaning is its content; kind identity lives on the card page.
          The tag doubles as the density toggle (goal 0105 part 3):
          grid <-> pills, persisted per card. */}
      <div className={noteStyles.frontHeader}>
        <div className={noteStyles.title}>{card.Title}</div>
        <button
          type="button"
          className={`${styles.tableTag} nodrag`}
          data-testid="atlas-table-density-toggle"
          title={t('projection.densityToggleTitle')}
          onClick={(e) => {
            e.stopPropagation()
            void AtlasService.SetCardProjectionDensity(card.ID, card.ProjectionDensity === 'pills' ? 'grid' : 'pills')
          }}
        >
          {card.ProjectionDensity === 'pills' ? t('projection.pillsTag') : t('projection.tableTag')}
        </button>
      </div>
      <AtlasCardProjectionTable scopeID={card.ID} density={card.ProjectionDensity} fetchProjection={AtlasService.CardListProjection} />
    </div>
  )
})
