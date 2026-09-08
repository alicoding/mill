import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMPTY_SELECTION, LONG_PRESS_MS, activateRow, clearSelected, extendFocus as extendFocusCore,
  isSelectionMode, longPressStillArmed, pruneSelection, rangeSelected, selectAllSelected, toggleSelected, withFocusedId,
  type ActivationMods, type ListSelectionState,
} from './listSelectionCore'

// The React wrapper around listSelectionCore.ts's pure state machine
// (goal 0404 S1) -- holds the state, an always-current ref to the
// caller's own ordered/filtered ids (range and selectAll must read
// whatever is current at call time, not whatever was passed at the
// render that created the callback), and the setTimeout a long-press
// needs. InventoryList is the only caller; InventoryRow never imports
// this directly.

export interface PointerLike {
  pointerType: string
  clientX: number
  clientY: number
}

export interface UseListSelectionResult {
  selected: ReadonlySet<string>
  isSelectionMode: boolean
  isSelected: (id: string) => boolean
  toggle: (id: string) => void
  range: (id: string) => void
  // Over the hook's own bound ids (the current page) -- ⌘A and a
  // header checkbox both mean "everything visible."
  selectAll: () => void
  // Over an explicit, caller-supplied set beyond the bound page (the
  // bar's "Select all {N}" when the selection is partial against the
  // full filtered count, Gmail/Drive's own cross-page expand).
  selectAllOf: (ids: string[]) => void
  clear: () => void
  // Drops any selected id no longer in `validIds` -- the caller's own
  // job (InventoryList, keyed on the full FILTERED set, not this
  // hook's own bound page) since a changed search/filter/usage-toggle
  // must never leave a phantom row checked (Configure Lists' Unused
  // filter is the proving case).
  pruneTo: (validIds: string[]) => void
  activate: (id: string, mods: ActivationMods) => boolean
  focusedId: string | null
  setFocusedId: (id: string | null) => void
  extendFocus: (direction: 'up' | 'down') => void
  handlePointerDown: (id: string, e: PointerLike) => void
  handlePointerMove: (e: PointerLike) => void
  handlePointerUp: () => void
  handlePointerCancel: () => void
}

export function useListSelection(ids: string[]): UseListSelectionResult {
  const [state, setState] = useState<ListSelectionState>(EMPTY_SELECTION)
  // Kept current in an effect, never written during render (React
  // Compiler's react-hooks/refs rule) -- range/selectAll/extendFocus
  // are handed straight to event handlers and must read whatever ids
  // are current AT THE MOMENT of the interaction, not the ids captured
  // at whichever render created the callback.
  const idsRef = useRef(ids)
  useEffect(() => {
    idsRef.current = ids
  })

  const longPressTimer = useRef<number | null>(null)
  const longPressStart = useRef<{ x: number; y: number } | null>(null)
  const longPressId = useRef<string | null>(null)
  const clearLongPressTimer = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    longPressStart.current = null
    longPressId.current = null
  }, [])

  const toggle = useCallback((id: string) => setState((prev) => toggleSelected(prev, id)), [])
  const range = useCallback((id: string) => setState((prev) => rangeSelected(prev, idsRef.current, id)), [])
  const selectAll = useCallback(() => setState((prev) => selectAllSelected(prev, idsRef.current)), [])
  const selectAllOf = useCallback((ids: string[]) => setState((prev) => selectAllSelected(prev, ids)), [])
  const clear = useCallback(() => setState(clearSelected), [])
  const pruneTo = useCallback((validIds: string[]) => setState((prev) => pruneSelection(prev, validIds)), [])

  const activate = useCallback((id: string, mods: ActivationMods): boolean => {
    let opensRow = false
    setState((prev) => {
      const result = activateRow(prev, idsRef.current, id, mods)
      opensRow = result.opensRow
      return result.state
    })
    return opensRow
  }, [])

  const setFocusedId = useCallback((id: string | null) => setState((prev) => withFocusedId(prev, id)), [])
  const extendFocus = useCallback((direction: 'up' | 'down') => setState((prev) => extendFocusCore(prev, idsRef.current, direction)), [])

  const handlePointerDown = useCallback((id: string, e: PointerLike) => {
    if (e.pointerType === 'mouse') return
    clearLongPressTimer()
    longPressStart.current = { x: e.clientX, y: e.clientY }
    longPressId.current = id
    longPressTimer.current = window.setTimeout(() => {
      const target = longPressId.current
      clearLongPressTimer()
      if (target !== null) setState((prev) => toggleSelected(prev, target))
    }, LONG_PRESS_MS)
  }, [clearLongPressTimer])

  const handlePointerMove = useCallback((e: PointerLike) => {
    const start = longPressStart.current
    if (!start) return
    if (!longPressStillArmed(start, { x: e.clientX, y: e.clientY })) clearLongPressTimer()
  }, [clearLongPressTimer])

  const handlePointerUp = useCallback(() => clearLongPressTimer(), [clearLongPressTimer])
  const handlePointerCancel = useCallback(() => clearLongPressTimer(), [clearLongPressTimer])

  return {
    selected: state.selected,
    isSelectionMode: isSelectionMode(state),
    isSelected: (id: string) => state.selected.has(id),
    toggle,
    range,
    selectAll,
    selectAllOf,
    clear,
    pruneTo,
    activate,
    focusedId: state.focusedId,
    setFocusedId,
    extendFocus,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  }
}
