import { useTranslation } from 'react-i18next'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Card, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { buildSlotRows } from './atlasSlotRowModel'
import styles from './AtlasSlotRows.module.css'

// The flip back face's fixed footprint (goal 0081 slice A4, LOCKED
// design §3/D1.5) only ever fits this many rows before the card grows
// taller than its uniform note size -- capped, not scrolled, with the
// remainder named by the overflow line below (the page shows every
// kind; the canvas glance does not need to).
const MAX_VISIBLE_ROWS = 2

// The typed link slots block (goal 0081 slice A4, LOCKED design §3
// "the slot IS the type"): one row per declared link kind, links-first
// (atlasSlotRowModel.ts), each carrying its own drag ANCHOR -- dragging
// FROM a row starts a link of exactly that row's kind (useAtlasSlotDrag
// owns the gesture; this component only ever reports where it started).
// Shared by AtlasNoteCardNode's and AtlasGroupNode's own back faces --
// one component, both flip surfaces, never a second implementation.
export function AtlasSlotRows({ card, allCards, links, linkKinds, onChipClick, onRemoveLink, onAnchorPointerDown }: {
  card: Card
  allCards: Card[]
  links: Link[]
  linkKinds: LinkKind[]
  onChipClick: (cardID: string) => void
  onRemoveLink: (linkID: string) => void
  onAnchorPointerDown: (linkKindID: string, e: ReactPointerEvent) => void
}) {
  const { t } = useTranslation('atlas')
  const rows = buildSlotRows(card, allCards, links, linkKinds)
  const visible = rows.slice(0, MAX_VISIBLE_ROWS)
  const overflowCount = rows.length - visible.length

  if (rows.length === 0) return null

  return (
    <div className={`${styles.block} nodrag nopan`} data-testid="atlas-slot-rows">
      {visible.map((row) => (
        <div className={styles.row} key={row.linkKindID} data-testid={`atlas-slot-row-${row.linkKindID}`}>
          <span className={styles.kindLabel}>{row.label}</span>
          <span className={styles.chips}>
            {row.chips.length === 0 && <span className={styles.dragHint}>{t('board.slotDragToAdd')}</span>}
            {row.chips.map((chip) => (
              <span className={styles.chip} key={chip.linkID} data-testid="atlas-slot-chip">
                <button
                  type="button"
                  className={styles.chipLabel}
                  onClick={(e) => {
                    e.stopPropagation()
                    onChipClick(chip.cardID)
                  }}
                >
                  {chip.direction === 'in' ? `← ${chip.title}` : chip.title}
                </button>
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={t('overlay.removeLinkAriaLabel', { title: chip.title })}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveLink(chip.linkID)
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </span>
          <span
            className={styles.anchor}
            data-testid={`atlas-slot-anchor-${row.linkKindID}`}
            role="button"
            tabIndex={-1}
            aria-label={t('board.slotDragToAdd')}
            onPointerDown={(e) => {
              e.stopPropagation()
              onAnchorPointerDown(row.linkKindID, e)
            }}
          />
        </div>
      ))}
      {overflowCount > 0 && (
        <div className={styles.overflow} data-testid="atlas-slot-overflow">
          {t('board.slotMoreKinds', { count: overflowCount })}
        </div>
      )}
    </div>
  )
}
