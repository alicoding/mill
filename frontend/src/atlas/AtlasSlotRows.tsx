import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Select } from '@primer/react'
import type { Card, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { buildSlotRows } from './atlasSlotRowModel'
import styles from './AtlasSlotRows.module.css'

// The typed link slots block (goal 0081 slice A4, LOCKED design §3
// "the slot IS the type"; the canvas-face variant retired by goal
// 0106 -- the card page is now the ONLY place a link's kind is picked
// or changed directly): one row per declared link kind, links-first
// (atlasSlotRowModel.ts), chips identical to how the board itself
// renders a card's link count. Every row shows, trailing a card
// SELECT + Add button.
export function AtlasSlotRows({
  card, allCards, links, linkKinds, onChipClick, onRemoveLink, onAddLink,
}: {
  card: Card
  allCards: Card[]
  links: Link[]
  linkKinds: LinkKind[]
  onChipClick: (cardID: string) => void
  onRemoveLink: (linkID: string) => void
  onAddLink: (linkKindID: string, toCardID: string) => void
}) {
  const { t } = useTranslation('atlas')
  const rows = buildSlotRows(card, allCards, links, linkKinds)
  const pickable = allCards.filter((c) => c.ID !== card.ID)
  const [pendingByRow, setPendingByRow] = useState<Record<string, string>>({})

  if (rows.length === 0) return null

  return (
    <div className={`${styles.block} nodrag nopan`} data-testid="atlas-slot-rows" data-variant="page">
      {rows.map((row) => (
        <div className={styles.row} key={row.linkKindID} data-testid={`atlas-slot-row-${row.linkKindID}`}>
          <span className={styles.kindLabel}>{row.label}</span>
          <span className={styles.chips}>
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
                onAddLink(row.linkKindID, toCardID)
                setPendingByRow((prev) => ({ ...prev, [row.linkKindID]: '' }))
              }}
            >
              {t('overlay.addLink')}
            </Button>
          </span>
        </div>
      ))}
    </div>
  )
}
