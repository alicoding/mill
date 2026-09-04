import { sortByUpdatedDesc } from './inventorySort'

// The one list standard every inventory and data table shares
// (docs/goals/0337): a fixed page size, one sort model, one
// examples-at-the-bottom split, one count string, one per-list piece of
// view state. Pure functions only -- the React surfaces that consume
// them are ListToolbar.tsx, InventoryList.tsx and the DataTable pages,
// so a page can never grow its own page-size or sort semantics.

// Fixed, deliberately not user-selectable: a page-size picker is a
// preference the standard does not offer, so nothing persists it.
export const LIST_PAGE_SIZE = 25

export type ListSort = 'updated' | 'name' | 'created'

export const LIST_SORTS: ListSort[] = ['updated', 'name', 'created']

export interface ListSortable {
  label: string
  // Both are the raw wire timestamps (Go RFC3339), not the rendered
  // caption -- inventorySort.ts's parser already treats a Go zero time
  // as unstamped, so a legacy record never jumps to the top.
  updatedAt?: string
  createdAt?: string
}

// sortItems returns a NEW array. 'updated' and 'created' delegate to
// the shared last-updated-first comparator (stable, unstamped last), so
// an item type carrying neither timestamp keeps the order it arrived
// in rather than being reshuffled.
export function sortItems<T extends ListSortable>(items: T[], sort: ListSort): T[] {
  if (sort === 'name') {
    return [...items].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  }
  if (sort === 'created') return sortByUpdatedDesc(items, (item) => item.createdAt)
  return sortByUpdatedDesc(items, (item) => item.updatedAt)
}

// availableSorts drops any ordering no item in this list can answer, so
// a sort menu never offers a choice that would silently no-op. A list
// whose items carry no timestamps at all is left with one option, and
// the toolbar hides the menu entirely -- the page's own incoming order
// (a usage ranking, say) then stands unchallenged.
export function availableSorts(items: Pick<ListSortable, 'updatedAt' | 'createdAt'>[]): ListSort[] {
  const stamped = (field: 'updatedAt' | 'createdAt') =>
    items.some((item) => typeof item[field] === 'string' && item[field] !== '')
  const hasUpdated = stamped('updatedAt')
  const hasCreated = stamped('createdAt')
  return LIST_SORTS.filter((sort) => {
    if (sort === 'created') return hasCreated
    if (sort === 'updated') return hasUpdated
    return true
  })
}

// splitExamples separates the seeded examples from the user's own
// items, preserving each side's incoming order. Examples render in
// their own collapsible group at the bottom and are never paginated.
export function splitExamples<T extends { builtIn?: boolean }>(items: T[]): { own: T[]; examples: T[] } {
  const own: T[] = []
  const examples: T[] = []
  for (const item of items) {
    if (item.builtIn === true) examples.push(item)
    else own.push(item)
  }
  return { own, examples }
}

// pageCountFor never returns 0 -- an empty list is still "page 1 of 1",
// which is what keeps clampPage and the range label total functions.
export function pageCountFor(total: number, pageSize: number = LIST_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1
  return Math.min(Math.max(1, Math.trunc(page)), pageCount)
}

// pageItems slices one 1-based page. A page past the end clamps rather
// than returning nothing, so a filter that shrinks the list while the
// user sits on page 3 can never render a blank region.
export function pageItems<T>(items: T[], page: number, pageSize: number = LIST_PAGE_SIZE): T[] {
  const current = clampPage(page, pageCountFor(items.length, pageSize))
  const start = (current - 1) * pageSize
  return items.slice(start, start + pageSize)
}

export interface ListCount {
  key: string
  params: Record<string, number>
}

// listCountLabel picks which of the three count strings the toolbar
// renders. Paged wins over narrowed (a range already implies both
// numbers), narrowed wins over the bare total.
export function listCountLabel(input: { total: number; shown: number; from?: number; to?: number }): ListCount {
  const { total, shown, from, to } = input
  if (from !== undefined && to !== undefined) {
    return { key: 'list.countRange', params: { from, to, total } }
  }
  if (shown !== total) return { key: 'list.countNarrowed', params: { shown, total } }
  return { key: 'list.countTotal', params: { total } }
}

export interface ListViewState {
  sort: ListSort
  page: number
  // undefined means "not decided by the user yet" -- the surface then
  // falls back to the contract's default (expanded only when the user
  // owns nothing in this list).
  examplesExpanded?: boolean
}

export const DEFAULT_LIST_VIEW_STATE: ListViewState = { sort: 'updated', page: 1 }

export function listStateKey(listId: string): string {
  return `mill.list.${listId}`
}

// A minimal structural view of Storage: sessionStorage in the app, a
// stub (including a throwing one) in tests.
export interface ListStateStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

function defaultStorage(): ListStateStorage | null {
  try {
    return window.sessionStorage
  } catch {
    // Storage blocked by the browser's site-data policy throws on
    // access, not on read -- the list must still render.
    return null
  }
}

function isListSort(value: unknown): value is ListSort {
  return value === 'updated' || value === 'name' || value === 'created'
}

// readListState never throws and never trusts what it parses: a blocked
// or corrupted store costs the memory of the last sort/page, never the
// list itself.
export function readListState(listId: string, storage: ListStateStorage | null = defaultStorage()): ListViewState {
  if (!storage) return { ...DEFAULT_LIST_VIEW_STATE }
  try {
    const raw = storage.getItem(listStateKey(listId))
    if (raw === null) return { ...DEFAULT_LIST_VIEW_STATE }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_LIST_VIEW_STATE }
    const record = parsed as Record<string, unknown>
    return {
      sort: isListSort(record.sort) ? record.sort : DEFAULT_LIST_VIEW_STATE.sort,
      page: typeof record.page === 'number' && Number.isFinite(record.page) ? clampPage(record.page, Number.MAX_SAFE_INTEGER) : 1,
      examplesExpanded: typeof record.examplesExpanded === 'boolean' ? record.examplesExpanded : undefined,
    }
  } catch {
    return { ...DEFAULT_LIST_VIEW_STATE }
  }
}

export function writeListState(listId: string, state: ListViewState, storage: ListStateStorage | null = defaultStorage()): void {
  if (!storage) return
  try {
    storage.setItem(listStateKey(listId), JSON.stringify(state))
  } catch {
    // Write-blocked storage is a lost preference, not a failed action:
    // nothing user-initiated is pending on it, so there is no notice to
    // post (.claude/rules/frontend.md's two-doors rule covers the
    // promise-shaped cases, not this synchronous one).
  }
}
