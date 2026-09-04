import { useCallback, useState } from 'react'
import { readListState, writeListState, type ListSort, type ListViewState } from './listStandard'

// Per-list view state (sort, page, whether the Examples group is open)
// for the one list standard (docs/goals/0337). Persisted per list id in
// sessionStorage so switching tabs and coming back keeps the page you
// were on, while a new session starts clean. Search text is
// deliberately NOT persisted -- a stale query silently hiding rows on
// return is the failure mode that costs more than it saves.
//
// listId is read once, at mount: every consumer renders exactly one
// list per mounted page, so a changing id would be a different surface,
// not a different state key for the same one.
export function useListState(listId: string) {
  const [state, setState] = useState<ListViewState>(() => readListState(listId))

  const patch = useCallback((next: Partial<ListViewState>) => {
    setState((prev) => {
      const merged = { ...prev, ...next }
      writeListState(listId, merged)
      return merged
    })
  }, [listId])

  // Any change to what the list contains or how it is ordered returns
  // to page 1 -- staying on page 3 of a freshly narrowed result is how
  // a filter appears to have emptied the list.
  const setSort = useCallback((sort: ListSort) => patch({ sort, page: 1 }), [patch])
  const setPage = useCallback((page: number) => patch({ page }), [patch])
  const resetPage = useCallback(() => {
    setState((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }))
  }, [])
  const setExamplesExpanded = useCallback((examplesExpanded: boolean) => patch({ examplesExpanded }), [patch])

  return { state, setSort, setPage, resetPage, setExamplesExpanded }
}
