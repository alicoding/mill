import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredOverlay, Button, FormControl, Stack, TextInput } from '@primer/react'
import type { GridColumnFilter } from './listStandard'
import type { GridColumn } from './listGridTypes'
import styles from './ListGrid.module.css'

// One column's filter, anchored to its own header (goal 0349 S4). The
// adopted grid leaves narrowing to the integrator by design, so this is
// Mill's composition on the grid's header rectangle -- the same
// AnchoredOverlay the column's schema popover uses. A text column
// filters by substring; a number, integer, date or datetime column
// filters by an inclusive range.
const RANGE_TYPES = new Set(['number', 'integer', 'date', 'datetime'])

export function isRangeColumn(column: GridColumn): boolean {
  return RANGE_TYPES.has(column.Type ?? '')
}

export function ListGridGlideFilter({ column, filter, onApply, onClose, anchorRef }: {
  column: GridColumn
  filter: GridColumnFilter
  onApply: (next: GridColumnFilter) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation('common')
  const [draft, setDraft] = useState<GridColumnFilter>(filter)
  const ranged = isRangeColumn(column)
  const apply = (next: GridColumnFilter) => {
    onApply(next)
    onClose()
  }
  return (
    <AnchoredOverlay open onClose={onClose} anchorRef={anchorRef as React.RefObject<HTMLElement>} renderAnchor={null}>
      <div className={styles.popover} data-testid="list-grid-filter-popover">
        {ranged ? (
          <Stack direction="horizontal" gap="condensed">
            <FormControl>
              <FormControl.Label>{t('listGrid.filterMin')}</FormControl.Label>
              <TextInput value={draft.min ?? ''} data-testid="list-grid-filter-min" onChange={(e) => setDraft({ ...draft, min: e.target.value })} />
            </FormControl>
            <FormControl>
              <FormControl.Label>{t('listGrid.filterMax')}</FormControl.Label>
              <TextInput value={draft.max ?? ''} data-testid="list-grid-filter-max" onChange={(e) => setDraft({ ...draft, max: e.target.value })} />
            </FormControl>
          </Stack>
        ) : (
          <FormControl>
            <FormControl.Label>{t('listGrid.filterContains')}</FormControl.Label>
            <TextInput
              value={draft.contains ?? ''}
              data-testid="list-grid-filter-contains"
              onKeyDown={(e) => { if (e.key === 'Enter') apply(draft) }}
              onChange={(e) => setDraft({ ...draft, contains: e.target.value })}
            />
          </FormControl>
        )}
        <Stack direction="horizontal" gap="condensed">
          <Button size="small" variant="primary" data-testid="list-grid-filter-apply" onClick={() => apply(draft)}>{t('listGrid.filterApply')}</Button>
          <Button size="small" variant="invisible" data-testid="list-grid-filter-clear" onClick={() => apply({})}>{t('listGrid.filterClear')}</Button>
        </Stack>
      </div>
    </AnchoredOverlay>
  )
}
