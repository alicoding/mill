import { useState } from 'react'

// The cards/table mode state for a data-inventory page, persisted per
// page in localStorage -- split from ViewModeToggle.tsx so that file
// only exports a component (react-refresh's fast-refresh constraint).

export type ViewMode = 'cards' | 'table'

export function useViewMode(storageKey: string): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => (localStorage.getItem(storageKey) === 'table' ? 'table' : 'cards'))
  const set = (m: ViewMode) => {
    setMode(m)
    localStorage.setItem(storageKey, m)
  }
  return [mode, set]
}
