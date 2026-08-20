import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import styles from './AtlasTableSizePicker.module.css'

const COLS = 8
const ROWS = 6

// The table size picker (goal 0137): sweep the mini-grid to the shape
// you want, click, and the table exists -- creation carries no other
// questions. Cells are plain buttons inside the kit's anchored
// overlay; the highlight covers every cell up-and-left of the hover.
export function AtlasTableSizePicker({ onPick }: { onPick: (cols: number, rows: number) => void }) {
  const { t } = useTranslation('atlas')
  const [hover, setHover] = useState<{ c: number; r: number } | null>(null)

  return (
    <div className={styles.picker} data-testid="atlas-table-size-picker" onMouseLeave={() => setHover(null)}>
      <div className={styles.grid} role="grid" aria-label={t('tableSize.hint')}>
        {Array.from({ length: ROWS }, (_, r) => (
          <div key={r} className={styles.row} role="row">
            {Array.from({ length: COLS }, (_, c) => (
              <button
                key={c}
                type="button"
                role="gridcell"
                className={styles.cell}
                data-selected={hover !== null && c <= hover.c && r <= hover.r ? 'true' : undefined}
                data-testid={`atlas-table-size-${c + 1}x${r + 1}`}
                aria-label={t('tableSize.cellAriaLabel', { cols: c + 1, rows: r + 1 })}
                onMouseEnter={() => setHover({ c, r })}
                onFocus={() => setHover({ c, r })}
                onClick={() => onPick(c + 1, r + 1)}
              />
            ))}
          </div>
        ))}
      </div>
      <Text size="small" className={styles.hint} data-testid="atlas-table-size-label">
        {hover ? t('tableSize.dimensions', { cols: hover.c + 1, rows: hover.r + 1 }) : t('tableSize.hint')}
      </Text>
    </div>
  )
}
