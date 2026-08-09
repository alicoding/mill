import { SegmentedControl } from '@primer/react'
import { RowsIcon, TableIcon } from '@primer/octicons-react'
import type { ViewMode } from './viewMode'

// One shared cards/table view switch for every data-inventory page
// (docs/SPEC.md §3.5's Update: "all the pages that have data get a
// table view") -- the table half is Primer's own DataTable (adopted,
// .claude/rules/frontend.md's component reference), this is only the
// mode toggle; its localStorage-backed state lives in viewMode.ts.

export function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <SegmentedControl aria-label="View mode" size="small" onChange={(i) => onChange(i === 0 ? 'cards' : 'table')}>
      <SegmentedControl.IconButton icon={RowsIcon} aria-label="Card view" selected={mode === 'cards'} />
      <SegmentedControl.IconButton icon={TableIcon} aria-label="Table view" selected={mode === 'table'} />
    </SegmentedControl>
  )
}
