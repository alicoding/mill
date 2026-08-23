import { useTranslation } from 'react-i18next'
import { PENCIL_COLORS, PENCIL_SIZES, useAtlasPencilStyle } from './atlasPencilStyleStore'
import styles from './AtlasPencilStylePicker.module.css'

// The pencil tool's own options bar (goal 0169 slice 3): shown
// anchored to the tray button for exactly as long as pencil is the
// armed tool (AtlasCreationTray.tsx), the same way a real drawing
// app's tool options surface while that tool is selected. Every
// choice here writes straight to the ephemeral style cache
// (atlasPencilStyleStore.ts) -- never to the board -- and seeds the
// NEXT stroke; an already-drawn stroke's own colour/size never changes
// retroactively.
export function AtlasPencilStylePicker() {
  const { t } = useTranslation('atlas')
  const { color, size, setColor, setSize } = useAtlasPencilStyle()

  return (
    <div className={styles.picker} data-testid="atlas-pencil-style-picker">
      <div className={styles.row} role="group" aria-label={t('pencilStyle.colorLabel')}>
        {PENCIL_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={styles.swatch}
            data-testid={`atlas-pencil-color-${c.slice(1)}`}
            data-selected={c === color}
            aria-pressed={c === color}
            aria-label={c}
            style={{ backgroundColor: c }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <div className={styles.row} role="group" aria-label={t('pencilStyle.sizeLabel')}>
        {PENCIL_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            className={styles.sizeButton}
            data-testid={`atlas-pencil-size-${s}`}
            data-selected={s === size}
            aria-pressed={s === size}
            aria-label={t('pencilStyle.sizeOption', { size: s })}
            onClick={() => setSize(s)}
          >
            <span className={styles.sizeDot} style={{ width: s * 2, height: s * 2 }} />
          </button>
        ))}
      </div>
    </div>
  )
}
