import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Button, Select } from '@primer/react'
import type { Card, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { buildSlotRows } from './atlasSlotRowModel'
import styles from './AtlasSlotRows.module.css'

// The flip back face's fixed footprint (goal 0081 slice A4, LOCKED
// design §3/D1.5) only ever fits this many rows before the card grows
// taller than its uniform note size -- capped, not scrolled, with the
// remainder named by the overflow line below. The PAGE variant (goal
// 0081 slice A5) has no such footprint constraint and shows every kind
// (LOCKED design §5b), so the cap only applies to the 'canvas' variant.
const MAX_VISIBLE_ROWS = 2

// The typed link slots block (goal 0081 slice A4, LOCKED design §3
// "the slot IS the type"): one row per declared link kind, links-first
// (atlasSlotRowModel.ts), chips identical on both surfaces (LOCKED
// design §2 "chips are the record"). Two variants share this ONE
// component rather than forking -- the row/chip markup is identical
// either way, only the per-row trailing control and the cap differ:
//   - 'canvas' (default, the flip back face): capped to
//     MAX_VISIBLE_ROWS with an overflow line, trailing a drag ANCHOR --
//     dragging FROM a row starts a link of exactly that row's kind
//     (useAtlasSlotDrag owns the gesture; this component only reports
//     where it started).
//   - 'page' (the card page, no drag surface there): every row shown,
//     trailing a card SELECT + Add button (onAddLink) instead of an
//     anchor -- the LOCKED design's "each row's add control = a select
//     of cards + an Add button (no drag on the page)".
export function AtlasSlotRows({
  card, allCards, links, linkKinds, onChipClick, onRemoveLink,
  variant = 'canvas', onAnchorPointerDown, onAddLink,
}: {
  card: Card
  allCards: Card[]
  links: Link[]
  linkKinds: LinkKind[]
  onChipClick: (cardID: string) => void
  onRemoveLink: (linkID: string) => void
  variant?: 'canvas' | 'page'
  onAnchorPointerDown?: (linkKindID: string, e: ReactPointerEvent) => void
  onAddLink?: (linkKindID: string, toCardID: string) => void
}) {
  const { t } = useTranslation('atlas')
  const rows = buildSlotRows(card, allCards, links, linkKinds)
  const visible = variant === 'page' ? rows : rows.slice(0, MAX_VISIBLE_ROWS)
  const overflowCount = rows.length - visible.length
  const pickable = allCards.filter((c) => c.ID !== card.ID)
  const [pendingByRow, setPendingByRow] = useState<Record<string, string>>({})

  if (rows.length === 0) return null

  return (
    <div className={`${styles.block} nodrag nopan`} data-testid="atlas-slot-rows" data-variant={variant}>
      {visible.map((row) => (
        <div className={styles.row} key={row.linkKindID} data-testid={`atlas-slot-row-${row.linkKindID}`}>
          <span className={styles.kindLabel}>{row.label}</span>
          <span className={styles.chips}>
            {row.chips.length === 0 && variant === 'canvas' && <span className={styles.dragHint}>{t('board.slotDragToAdd')}</span>}
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
          {variant === 'page' ? (
            <span className={styles.pageAdd}>
              <Select
                size="small"
                aria-label={t('overlay.linkTargetLabel')}
                value={pendingByRow[row.linkKindID] ?? ''}
                data-testid={`atlas-slot-add-select-${row.linkKindID}`}
                onChange={(e) => setPendingByRow((prev) => ({ ...prev, [row.linkKindID]: e.target.value }))}
              >
                <Select.Option value="">{t('overlay.selectCard')}</Select.Option>
                {pickable.map((c) => (
                  <Select.Option key={c.ID} value={c.ID}>{c.Title}</Select.Option>
                ))}
              </Select>
              <Button
                size="small"
                data-testid={`atlas-slot-add-button-${row.linkKindID}`}
                disabled={!pendingByRow[row.linkKindID]}
                onClick={() => {
                  const toCardID = pendingByRow[row.linkKindID]
                  if (!toCardID) return
                  onAddLink?.(row.linkKindID, toCardID)
                  setPendingByRow((prev) => ({ ...prev, [row.linkKindID]: '' }))
                }}
              >
                {t('overlay.addLink')}
              </Button>
            </span>
          ) : (
            <span
              className={styles.anchor}
              data-testid={`atlas-slot-anchor-${row.linkKindID}`}
              role="button"
              tabIndex={-1}
              aria-label={t('board.slotDragToAdd')}
              onPointerDown={(e) => {
                e.stopPropagation()
                onAnchorPointerDown?.(row.linkKindID, e)
              }}
            />
          )}
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
