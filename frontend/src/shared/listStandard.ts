import type { GridColumn, GridRow } from './listGridTypes'
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

// ---------------------------------------------------------------------
// Grid row sort and filter (goal 0349 S4). The adopted grid renders and
// edits; ordering and narrowing rows is the integrator's job by that
// library's own design, so it composes here beside the inventory
// standard above rather than as a second sort/filter implementation
// inside the grid. Pure functions over the grid's render-side view of a
// List (listGridTypes.ts) -- the React surface that consumes them is
// ListGridGlide.tsx.

export type GridSortDirection = 'asc' | 'desc'

export interface GridColumnSort {
  key: string
  direction: GridSortDirection
}

// One column's narrowing. `contains` applies to any column (substring,
// case-insensitive); `min`/`max` bound a number, integer, date or
// datetime column inclusively. An absent or blank field never narrows.
export interface GridColumnFilter {
  contains?: string
  min?: string
  max?: string
}

export type GridColumnFilters = Record<string, GridColumnFilter>

// The header-click cycle: unsorted -> ascending -> descending ->
// unsorted, the spreadsheet convention.
export function nextSortDirection(current: GridSortDirection | undefined): GridSortDirection | undefined {
  if (current === undefined) return 'asc'
  return current === 'asc' ? 'desc' : undefined
}

const NUMERIC_TYPES = new Set(['number', 'integer'])
const TEMPORAL_TYPES = new Set(['date', 'datetime'])

// A column value's comparable form: a finite number for numeric
// columns, epoch ms for temporal ones, the lowercased string
// otherwise. Returns null when the cell cannot answer this column's
// type at all -- blanks and unparseable values sort and filter as
// "unknown" rather than as zero.
function comparable(value: string, type: string | undefined): number | string | null {
  const raw = value.trim()
  if (raw === '') return null
  if (NUMERIC_TYPES.has(type ?? '')) {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  if (TEMPORAL_TYPES.has(type ?? '')) {
    const t = Date.parse(raw)
    return Number.isNaN(t) ? null : t
  }
  return raw.toLocaleLowerCase()
}

function typeOf(columns: GridColumn[], key: string): string | undefined {
  return columns.find((c) => c.Key === key)?.Type
}

// filterGridRows keeps a row only when EVERY active filter accepts it
// (the spreadsheet convention: filters intersect, never union).
export function filterGridRows(rows: GridRow[], columns: GridColumn[], filters: GridColumnFilters): GridRow[] {
  const active = Object.entries(filters).filter(([, f]) => (f.contains ?? '') !== '' || (f.min ?? '') !== '' || (f.max ?? '') !== '')
  if (active.length === 0) return rows
  return rows.filter((row) => active.every(([key, filter]) => {
    const raw = row.Values?.[key] ?? ''
    if ((filter.contains ?? '') !== '' && !raw.toLocaleLowerCase().includes(filter.contains!.trim().toLocaleLowerCase())) return false
    const type = typeOf(columns, key)
    const bound = (edge: string | undefined) => (edge ?? '') === '' ? null : comparable(edge!, type)
    const low = bound(filter.min)
    const high = bound(filter.max)
    if (low === null && high === null) return true
    const cell = comparable(raw, type)
    // A blank or unparseable cell answers no range: a bounded column
    // shows only the rows that can actually be placed inside it.
    if (cell === null) return false
    if (low !== null && cell < low) return false
    if (high !== null && cell > high) return false
    return true
  }))
}

// sortGridRows returns a NEW array. Blanks and unparseable values sort
// LAST in both directions (the spreadsheet convention), so flipping the
// direction never floats a column's empty cells to the top.
export function sortGridRows(rows: GridRow[], columns: GridColumn[], sort: GridColumnSort | null): GridRow[] {
  if (!sort) return rows
  const type = typeOf(columns, sort.key)
  const factor = sort.direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = comparable(a.Values?.[sort.key] ?? '', type)
    const bv = comparable(b.Values?.[sort.key] ?? '', type)
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * factor
  })
}

// How many columns are currently narrowing the grid -- the count the
// toolbar's clear-filters action reports.
export function activeFilterCount(filters: GridColumnFilters): number {
  return Object.values(filters).filter((f) => (f.contains ?? '') !== '' || (f.min ?? '') !== '' || (f.max ?? '') !== '').length
}

// A cell's fill series: the next values continuing an arithmetic
// progression read off `source`, or null when the source is not one.
// Numbers step by their own delta; dates and datetimes step by their
// own millisecond delta, re-rendered in the source's own shape (a
// date-only source stays date-only). A single-cell or non-numeric
// source has no series -- the caller then lets the grid tile the
// pattern itself, which is that library's own fill behaviour.
export function fillSeries(source: string[], count: number, type: string | undefined): string[] | null {
  if (source.length < 2 || count < 1) return null
  const temporal = TEMPORAL_TYPES.has(type ?? '')
  const numbers = source.map((v) => temporal ? Date.parse(v.trim()) : Number(v.trim()))
  if (numbers.some((n) => !Number.isFinite(n))) return null
  const step = numbers[1] - numbers[0]
  for (let i = 2; i < numbers.length; i++) {
    if (numbers[i] - numbers[i - 1] !== step) return null
  }
  if (step === 0) return null
  const dateOnly = temporal && !source[0].includes('T')
  const out: string[] = []
  for (let i = 1; i <= count; i++) {
    const next = numbers[numbers.length - 1] + step * i
    if (!temporal) {
      out.push(String(next))
      continue
    }
    const iso = new Date(next).toISOString()
    out.push(dateOnly ? iso.slice(0, 10) : iso)
  }
  return out
}
