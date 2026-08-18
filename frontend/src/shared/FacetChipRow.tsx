import styles from './FacetChipRow.module.css'

// The faceted-search suggestion row (goal 0086): completion buttons
// only -- clicking one completes "<label>: " into the search input,
// nothing else. No Tab handling and no other chip state exist; typing
// the token is the primary path (shared/facetQuery.ts's grammar), this
// row is strictly the click-to-complete shortcut. Native <button>
// elements so keyboard Tab-focus and Enter/Space activation come for
// free, with the visible label doubling as the accessible name.

export interface FacetChipItem {
  key: string
  label: string
  // A CSS custom property name (e.g. '--bgColor-accent-emphasis') for
  // a leading color dot -- the same kind-glyph idiom
  // atlas/AtlasJumpDialog.tsx's own result rows and atlas/KindPicker.tsx
  // already use. Omitted renders a plain, uncolored chip (the palette/
  // Quick Panel look).
  dotColorToken?: string
}

export function FacetChipRow({ items, onSelect, ariaLabel }: {
  items: FacetChipItem[]
  onSelect: (key: string) => void
  ariaLabel: string
}) {
  if (items.length === 0) return null
  return (
    <div className={styles.row} role="group" aria-label={ariaLabel} data-testid="facet-chip-row">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={styles.chip}
          onClick={() => onSelect(item.key)}
          data-testid="facet-chip"
        >
          {item.dotColorToken && (
            <span className={styles.dot} style={{ background: `var(${item.dotColorToken})` }} aria-hidden="true" data-testid="facet-chip-dot" />
          )}
          {item.label}
        </button>
      ))}
    </div>
  )
}
