import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { CircleSlashIcon } from '@primer/octicons-react'
import { useAtlasNounStyle, useAtlasSetStyleValue, type AtlasStyleValue } from './atlasStyleValueStore'
import type { AtlasStyleField } from './atlasStyleVocabulary'
import styles from './AtlasStylePanel.module.css'

// The one style panel every noun's declared `styleFields` renders
// through (goal 0209, replacing the AtlasShapeStylePicker/
// AtlasPencilStylePicker pair those two were duplicating -- the THIRD
// consumer was the signal CLAUDE.md's multi-purpose-surface rule names
// to extract a generic surface). Dispatches purely on each field's own
// `type` from atlasStyleVocabulary.ts's closed vocabulary -- NEVER on
// `nounId` (docs/goals/0211-extension-tiers.md's standing rule; the
// conformance suite greps this file for a noun-id branch and fails the
// build if one appears). Anchored the exact same way both hand-built
// pickers were (AtlasCreationTray.tsx's own AnchoredOverlay, unchanged
// by this migration).
export function AtlasStylePanel({ nounId, fields }: { nounId: string; fields: readonly AtlasStyleField[] }) {
  const { t } = useTranslation('atlas')
  const values = useAtlasNounStyle(nounId)
  const setValue = useAtlasSetStyleValue()
  const onSelect = (key: string, value: AtlasStyleValue) => setValue(nounId, key, value)

  return (
    <div className={styles.picker} data-testid={`atlas-${nounId}-style-picker`}>
      {fields.map((field) => (
        <div key={field.key} className={styles.row} role="group" aria-label={t(field.groupLabelKey)}>
          {renderFieldOptions(field, values[field.key], onSelect, t)}
        </div>
      ))}
    </div>
  )
}

function renderFieldOptions(field: AtlasStyleField, current: AtlasStyleValue | undefined, onSelect: (key: string, value: AtlasStyleValue) => void, t: TFunction) {
  if (field.type === 'shape-kind') {
    return field.options.map((opt) => (
      <button
        key={opt.value}
        type="button"
        className={styles.kindButton}
        data-testid={`${field.testidPrefix}-${opt.value}`}
        data-selected={opt.value === current}
        aria-pressed={opt.value === current}
        aria-label={t(opt.labelKey)}
        onClick={() => onSelect(field.key, opt.value)}
      >
        <opt.Icon size={14} />
      </button>
    ))
  }
  if (field.type === 'color' || field.type === 'color-or-none') {
    return (
      <>
        {field.type === 'color-or-none' && (
          <button
            type="button"
            className={styles.noneSwatch}
            data-testid={`${field.testidPrefix}-none`}
            data-selected={current === 'none'}
            aria-pressed={current === 'none'}
            aria-label={t(field.noneLabelKey)}
            onClick={() => onSelect(field.key, 'none')}
          >
            <CircleSlashIcon size={12} />
          </button>
        )}
        {field.options.map((c) => (
          <button
            key={c}
            type="button"
            className={styles.swatch}
            data-testid={`${field.testidPrefix}-${c.slice(1)}`}
            data-selected={c === current}
            aria-pressed={c === current}
            aria-label={c}
            style={{ backgroundColor: c }}
            onClick={() => onSelect(field.key, c)}
          />
        ))}
      </>
    )
  }
  // field.type === 'stroke-width'
  return field.options.map((w) => (
    <button
      key={w}
      type="button"
      className={styles.optionButton}
      data-testid={`${field.testidPrefix}-${w}`}
      data-selected={w === current}
      aria-pressed={w === current}
      aria-label={t(field.optionLabelKey, field.render === 'line' ? { width: w } : { size: w })}
      onClick={() => onSelect(field.key, w)}
    >
      {field.render === 'line' ? (
        <span className={styles.lineIndicator} style={{ height: w }} />
      ) : (
        <span className={styles.dotIndicator} style={{ width: w * 2, height: w * 2 }} />
      )}
    </button>
  ))
}
