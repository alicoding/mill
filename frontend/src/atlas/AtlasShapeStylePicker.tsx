import { useTranslation } from 'react-i18next'
import { ArrowUpRightIcon, CircleIcon, SquareIcon } from '@primer/octicons-react'
import { PENCIL_COLORS } from './atlasPencilStyleStore'
import { SHAPE_STROKE_WIDTHS, useAtlasShapeStyle, type AtlasShapeType } from './atlasShapeStyleStore'
import styles from './AtlasShapeStylePicker.module.css'

const SHAPE_TYPES: { type: AtlasShapeType; Icon: typeof SquareIcon }[] = [
  { type: 'rectangle', Icon: SquareIcon },
  { type: 'ellipse', Icon: CircleIcon },
  { type: 'arrow', Icon: ArrowUpRightIcon },
]

// The shape tool's own options bar (goal 0169 slice 5): shown anchored
// to the tray button for exactly as long as shape is the armed tool
// (AtlasCreationTray.tsx), mirroring AtlasPencilStylePicker.tsx's own
// surface. Every choice here writes straight to the ephemeral style
// cache (atlasShapeStyleStore.ts) -- never to the board -- and seeds
// the NEXT shape; an already-drawn shape's own style never changes
// retroactively (0193's own style-editor scope, not this one).
export function AtlasShapeStylePicker() {
  const { t } = useTranslation('atlas')
  const { shapeType, stroke, strokeWidth, setShapeType, setStroke, setStrokeWidth } = useAtlasShapeStyle()

  return (
    <div className={styles.picker} data-testid="atlas-shape-style-picker">
      <div className={styles.row} role="group" aria-label={t('shapeStyle.typeLabel')}>
        {SHAPE_TYPES.map(({ type, Icon }) => (
          <button
            key={type}
            type="button"
            className={styles.typeButton}
            data-testid={`atlas-shape-type-${type}`}
            data-selected={type === shapeType}
            aria-pressed={type === shapeType}
            aria-label={t(`shapeStyle.type_${type}`)}
            onClick={() => setShapeType(type)}
          >
            <Icon size={14} />
          </button>
        ))}
      </div>
      <div className={styles.row} role="group" aria-label={t('shapeStyle.strokeLabel')}>
        {PENCIL_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={styles.swatch}
            data-testid={`atlas-shape-stroke-${c.slice(1)}`}
            data-selected={c === stroke}
            aria-pressed={c === stroke}
            aria-label={c}
            style={{ backgroundColor: c }}
            onClick={() => setStroke(c)}
          />
        ))}
      </div>
      <div className={styles.row} role="group" aria-label={t('shapeStyle.widthLabel')}>
        {SHAPE_STROKE_WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            className={styles.widthButton}
            data-testid={`atlas-shape-width-${w}`}
            data-selected={w === strokeWidth}
            aria-pressed={w === strokeWidth}
            aria-label={t('shapeStyle.widthOption', { width: w })}
            onClick={() => setStrokeWidth(w)}
          >
            <span className={styles.widthLine} style={{ height: w }} />
          </button>
        ))}
      </div>
    </div>
  )
}
