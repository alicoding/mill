import type { Icon } from '@primer/octicons-react'
import { Label, Text, ToggleSwitch } from '@primer/react'
import { useDisplayDensity } from '../shared/density'
import { extensionRowPadY } from './extensionMeta'
import styles from './ExtensionsSection.module.css'

// One Extensions row -- the SAME component for a built-in noun and an
// installed plugin (goal 0321). A row is identity only: icon, name,
// one line of description, and the control that turns it on. Nothing
// expands here: everything a row used to unfold inline (chips, the
// declared settings controls, reach, version, a docs link) lives in
// the detail pane the row opens, which is what stopped the list from
// being scannable.
//
// The row title region is a button and the toggle is its flex SIBLING,
// never a descendant: nesting a switch inside the row's own activation
// target makes one click mean two things, and puts an interactive
// element inside an interactive element.
export function ExtensionRow({ id, icon: RowIcon, name, description, control, enabled, selected, builtInLabel, toggleTestId = 'extensions-row-toggle', onSelect, onToggle }: {
  id: string
  icon: Icon
  name: string
  description?: string
  // 'switch' renders the enable toggle; 'built-in' renders the label a
  // kernel object carries instead; 'none' is a plugin the user cannot
  // turn on from here (blocked by policy, or waiting to be allowed).
  control: 'switch' | 'built-in' | 'none'
  enabled: boolean
  selected: boolean
  builtInLabel: string
  // The installed-plugin list keeps its own toggle hook so the plugin
  // specs address a plugin's switch without matching a built-in's.
  toggleTestId?: string
  onSelect: () => void
  onToggle: (enabled: boolean) => void
}) {
  const density = useDisplayDensity()
  const labelId = `extension-row-label-${id}`
  return (
    <div
      className={styles.row}
      style={{ paddingBlock: extensionRowPadY(density) }}
      data-testid="extensions-row"
      data-extension-id={id}
      data-selected={selected ? 'true' : undefined}
    >
      <button
        type="button"
        className={styles.rowButton}
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
        data-testid="extensions-row-open"
      >
        <RowIcon size={16} className={styles.rowIcon} />
        <Text id={labelId} size="small" weight="semibold" className={styles.rowName} data-testid="extensions-row-title">{name}</Text>
        {description && (
          <Text size="small" className={styles.rowDescription} data-testid="extensions-row-description">{description}</Text>
        )}
      </button>
      <div className={styles.rowAction}>
        {control === 'built-in' && <Label data-testid="extensions-row-built-in">{builtInLabel}</Label>}
        {control === 'switch' && (
          <ToggleSwitch
            aria-labelledby={labelId}
            checked={enabled}
            onChange={onToggle}
            size="small"
            className={styles.toggle}
            data-testid={toggleTestId}
          />
        )}
      </div>
    </div>
  )
}
