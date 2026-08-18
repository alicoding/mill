import { useEffect, useState } from 'react'
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
// renders a card's link count.
//
// A row with no chips yet collapses to a one-line "+ Add {kind}"
// invitation (goal 0106 slice B contract item 3's calm-page rule,
// applied here too -- the acceptance bar's "nothing else" on a
// title-only card's page covers every optional section, not only the
// ones the contract named by name): clicking it expands that row's
// own select+Add control, focused. A row that already carries a chip
// renders its full control immediately, same as before. Each row's own
// expand state is sticky once opened, matching AtlasCardPageFields.tsx's
// same rule -- clearing a just-added link back out mid-session never
// collapses the row back under the reader.
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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(rows.filter((r) => r.chips.length > 0).map((r) => r.linkKindID)))
  const [justExpandedRow, setJustExpandedRow] = useState<string | null>(null)
  const expand = (linkKindID: string) => {
    setExpanded((prev) => new Set(prev).add(linkKindID))
    setJustExpandedRow(linkKindID)
  }

  useEffect(() => {
    if (!justExpandedRow) return
    document.querySelector<HTMLElement>(`[data-testid="atlas-slot-add-select-${justExpandedRow}"]`)?.focus()
    setJustExpandedRow(null)
  }, [justExpandedRow])

  if (rows.length === 0) return null

  return (
    <div className={`${styles.block} nodrag nopan`} data-testid="atlas-slot-rows" data-variant="page">
      {rows.map((row) => (
        <div className={styles.row} key={row.linkKindID} data-testid={`atlas-slot-row-${row.linkKindID}`}>
          {row.chips.length > 0 && <span className={styles.kindLabel}>{row.label}</span>}
          {row.chips.length > 0 && (
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
          )}
          {expanded.has(row.linkKindID) ? (
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
          ) : (
            <Button
              size="small"
              variant="invisible"
              className={styles.quietAdd}
              data-testid={`atlas-slot-add-row-${row.linkKindID}`}
              onClick={() => expand(row.linkKindID)}
            >
              {t('page.addField', { label: row.label })}
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}
