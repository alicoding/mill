import { useState } from 'react'

// The rows/table mode state for a data-inventory page, persisted per
// page in localStorage -- split from ViewModeToggle.tsx so that file
// only exports a component (react-refresh's fast-refresh constraint).
//
// docs/goals/0007: dense InventoryList rows are now the DEFAULT view
// (cards are retired outright, not merely demoted); DataTable stays
// the secondary toggle view. A stored legacy 'cards' value (from
// before this goal) reads back as 'rows' rather than erroring or
// silently defaulting away from what the user actually had selected
// -- 'cards' was always the same "dense list, not the table" choice
// 'rows' is now, just under the old renderer.
export type ViewMode = 'rows' | 'table'

export function useViewMode(storageKey: string): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => (localStorage.getItem(storageKey) === 'table' ? 'table' : 'rows'))
  const set = (m: ViewMode) => {
    setMode(m)
    localStorage.setItem(storageKey, m)
  }
  return [mode, set]
}
