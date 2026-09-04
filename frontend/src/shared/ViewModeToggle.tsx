import { SegmentedControl } from '@primer/react'
import { copy } from './copy'
import { RowsIcon, TableIcon } from '@primer/octicons-react'
import type { ViewMode } from './viewMode'

// One shared rows/table view switch for every data-inventory page
// (docs/goals/0007: dense InventoryList rows are the DEFAULT,
// secondary DataTable toggle preserved) -- the table half is Primer's
// own DataTable (adopted, .claude/rules/frontend.md's component
// reference), this is only the mode toggle; its localStorage-backed
// state lives in viewMode.ts.

export function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <SegmentedControl aria-label={copy('viewMode.groupAriaLabel')} size="small" onChange={(i) => onChange(i === 0 ? 'rows' : 'table')}>
      <SegmentedControl.IconButton icon={RowsIcon} aria-label={copy('viewMode.rowAriaLabel')} selected={mode === 'rows'} />
      <SegmentedControl.IconButton icon={TableIcon} aria-label={copy('viewMode.tableAriaLabel')} selected={mode === 'table'} />
    </SegmentedControl>
  )
}
