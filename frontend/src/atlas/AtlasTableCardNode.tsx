import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Handle, Position as RFPosition } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { kindColorTokens } from './atlasKindColor'
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
export const AtlasTableCardNode = memo(function AtlasTableCardNode({ data }: NodeProps<AtlasNoteCardRFNode>) {
  const { t } = useTranslation('atlas')
  const { card, kind, pulsed, isSoleSelected, onCommit } = data
  const tokens = kindColorTokens(card.KindID)

  return (
    <div
      className={styles.card}
      data-testid="atlas-table-card"
      data-pulse={pulsed}
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
      <Handle type="target" position={RFPosition.Top} className={noteStyles.handle} />
      <Handle type="source" position={RFPosition.Bottom} className={noteStyles.handle} />
      <div className={noteStyles.frontHeader}>
        <span className={noteStyles.glyph} style={{ background: `var(${tokens.emphasis})` }}>
          {(kind?.Label ?? '?').charAt(0).toUpperCase()}
        </span>
        <span className={noteStyles.kindLabel}>{kind?.Label ?? ''}</span>
        <span className={styles.tableTag}>{t('projection.tableTag')}</span>
      </div>
      <div className={noteStyles.title}>{card.Title}</div>
      <AtlasCardProjectionTable cardID={card.ID} />
    </div>
  )
})
