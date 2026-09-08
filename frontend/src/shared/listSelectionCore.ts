// Pure state transitions for the one selection model every list
// surface shares (goal 0404 S1) -- no React, no DOM, so the whole
// truth table (each modifier, anchor-after-clear, select-all
// post-filter, long-press) is a plain Vitest table over plain objects.
// useListSelection.ts is the thin React wrapper around this file; it
// holds no logic of its own beyond useState/useCallback plumbing and
// the setTimeout a long-press needs.
//
// Gmail/Drive/Finder/Linear's converged five primitives: a checkbox
// toggle, Shift-click range, Cmd/Ctrl-click toggle-without-open, ⌘A
// select-all over the CALLER's own (already filtered) ids, Esc/Cancel
// clear -- plus Linear's Shift+↑/↓ range-from-focus and a touch
// long-press that toggles a row in the same way tapping its checkbox
// would.

export interface ListSelectionState {
  readonly selected: ReadonlySet<string>
  // The last row a plain toggle touched, or a range's own fixed start
  // -- Shift-clicking repeatedly re-spans from this ONE point (Finder/
  // Gmail), never from wherever the previous range happened to end.
  readonly anchor: string | null
  readonly focusedId: string | null
}

export const EMPTY_SELECTION: ListSelectionState = { selected: new Set(), anchor: null, focusedId: null }

export function isSelectionMode(state: ListSelectionState): boolean {
  return state.selected.size > 0
}

export function toggleSelected(state: ListSelectionState, id: string): ListSelectionState {
  const next = new Set(state.selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return { ...state, selected: next, anchor: id }
}

// A stale anchor (scrolled out of the current, already-filtered id
// list) restarts the range at `id` rather than throwing -- a changed
// filter/search must never make Shift-click misbehave.
export function rangeSelected(state: ListSelectionState, ids: string[], id: string): ListSelectionState {
  const anchor = state.anchor !== null && ids.includes(state.anchor) ? state.anchor : id
  const from = ids.indexOf(anchor)
  const to = ids.indexOf(id)
  if (from === -1 || to === -1) return toggleSelected(state, id)
  const [lo, hi] = from <= to ? [from, to] : [to, from]
  const next = new Set(state.selected)
  for (let i = lo; i <= hi; i++) next.add(ids[i])
  return { ...state, selected: next, anchor: state.anchor === null ? anchor : state.anchor }
}

export function selectAllSelected(state: ListSelectionState, ids: string[]): ListSelectionState {
  return { ...state, selected: new Set(ids) }
}

// A changed filter/search/page must never leave a phantom row selected
// (the bar's own count would drift from what's actually checked
// on-screen) -- keeps only ids still present in `validIds`, dropping a
// stale anchor/focus the same way. Returns the SAME state instance
// when nothing actually changed, so a caller can skip a state update
// (and the render it would trigger) on every filter recompute.
export function pruneSelection(state: ListSelectionState, validIds: string[]): ListSelectionState {
  if (state.selected.size === 0 && state.anchor === null && state.focusedId === null) return state
  const valid = new Set(validIds)
  let changed = false
  const next = new Set<string>()
  for (const id of state.selected) {
    if (valid.has(id)) next.add(id)
    else changed = true
  }
  const anchor = state.anchor !== null && valid.has(state.anchor) ? state.anchor : null
  const focusedId = state.focusedId !== null && valid.has(state.focusedId) ? state.focusedId : null
  if (!changed && anchor === state.anchor && focusedId === state.focusedId) return state
  return { selected: next, anchor, focusedId }
}

export function clearSelected(state: ListSelectionState): ListSelectionState {
  return { ...state, selected: new Set(), anchor: null }
}

export interface ActivationMods {
  shiftKey: boolean
  // Cmd on macOS, Ctrl elsewhere -- the caller resolves the platform
  // split (the browser's own select-all/copy convention), this file
  // only ever sees the one boolean.
  toggleModifier: boolean
}

// Decides a row click's effect: Shift ranges, the toggle modifier
// toggles without opening, and a plain click leaves state untouched
// and tells the caller to still open the row.
export function activateRow(state: ListSelectionState, ids: string[], id: string, mods: ActivationMods): { state: ListSelectionState; opensRow: boolean } {
  if (mods.shiftKey) return { state: rangeSelected(state, ids, id), opensRow: false }
  if (mods.toggleModifier) return { state: toggleSelected(state, id), opensRow: false }
  return { state, opensRow: true }
}

// The checkbox's own click carries the SAME Shift/toggle-modifier
// branches activateRow's row-body click does (Gmail/Drive: a modifier
// on the checkbox behaves like the modifier on the row) -- reuses
// activateRow rather than re-deriving the branches, so the two paths
// can never drift. The one difference: a checkbox never "opens" the
// row, so activateRow's plain-click opensRow signal becomes a toggle
// here instead of being left for a caller to open something with.
export function activateCheckbox(state: ListSelectionState, ids: string[], id: string, mods: ActivationMods): ListSelectionState {
  const result = activateRow(state, ids, id, mods)
  return result.opensRow ? toggleSelected(result.state, id) : result.state
}

// Shift+↑/↓ (Linear): extends the range toward the next/previous row
// and moves focus onto it. Starting with nothing focused begins at the
// first row for either direction, matching a fresh list's own reading
// order.
export function extendFocus(state: ListSelectionState, ids: string[], direction: 'up' | 'down'): ListSelectionState {
  if (ids.length === 0) return state
  const currentIdx = state.focusedId !== null ? ids.indexOf(state.focusedId) : -1
  const nextIdx = direction === 'up'
    ? Math.max(0, currentIdx === -1 ? 0 : currentIdx - 1)
    : Math.min(ids.length - 1, currentIdx === -1 ? 0 : currentIdx + 1)
  const nextId = ids[nextIdx]
  const anchored = state.anchor === null ? { ...state, anchor: state.focusedId ?? nextId } : state
  return { ...rangeSelected(anchored, ids, nextId), focusedId: nextId }
}

export function withFocusedId(state: ListSelectionState, id: string | null): ListSelectionState {
  return { ...state, focusedId: id }
}

// Long-press (touch/companion widths): a held pointer toggles its row
// in once armed, the same effect tapping its checkbox has -- ≥500ms,
// under the movement tolerance the whole time.
export const LONG_PRESS_MS = 500
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10

export interface Point {
  x: number
  y: number
}

// Whether a pointer that started at `start` and has moved to `current`
// still counts as "holding still" -- a real finger drifts a few px
// even at rest; a scroll/drag gesture moves far more.
export function longPressStillArmed(start: Point, current: Point): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) <= LONG_PRESS_MOVE_TOLERANCE_PX
}
