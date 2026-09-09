import { create } from 'zustand'

// The focused list surface's selection handle (goal 0404 S1), the same
// focus-scoped shape listGridSearchFocus.ts already established for
// exactly the same problem: list.selectAll/clearSelection/deleteSelection
// live at module scope with no way to reach a specific mounted
// InventoryList's own local selection state directly, and Configure's
// panes stay mounted (hidden) once visited (ConfigureView.tsx), so more
// than one InventoryList can exist in the DOM at once -- "act on
// whichever one currently holds focus" is the same real DOM focus-in/
// focus-out shape a ListGridGlide mount already uses, not a second
// invented mechanism.
//
// Exactly one handle at a time: focus is singular, so a second list
// taking focus replaces the first, and a list only clears the handle if
// it is still its own (blur and the next focus can arrive in either
// order).

export interface ListSelectionHandle {
  id: string
  selectAll: () => void
  clear: () => void
  hasSelection: () => boolean
  // The live selection's own size -- list.destroySelection's bulk
  // confirm (goal 0406 S2) interpolates it into "Delete {{count}}
  // forever?" before the batch actually runs.
  selectedCount: () => number
  // Deletes the current selection through its own entity's bulk-delete
  // door and posts the outcome toast -- InventoryList builds this
  // closure, since only it knows which entity/items are selected.
  // Omitted for a list mounted in Trash mode (goal 0406 S2): its own
  // selection deletes nothing, so list.deleteSelection's enabled()
  // stays false there rather than rendering a button that no-ops.
  deleteSelected?: () => void | Promise<void>
  // Restore / Delete forever over the current selection (goal 0406 S2)
  // -- present only for a list mounted in Trash mode
  // (InventoryList's `selection.mode`), so list.restoreSelection/
  // list.destroySelection stay honestly unavailable everywhere else.
  restoreSelected?: () => void | Promise<void>
  destroySelected?: () => void | Promise<void>
  // Space/x and Shift+Space on the row Tab landed on (goal 0404 S1):
  // act on `useListSelection`'s own
  // `focusedId` (set by the row's real onFocus, InventoryList.tsx),
  // a no-op with nothing focused (Tab never reached a row yet).
  toggleFocusedRow: () => void
  extendFocusedRow: () => void
}

interface ListSelectionFocusState {
  focused: ListSelectionHandle | null
  setFocused: (handle: ListSelectionHandle) => void
  clearFocused: (id: string) => void
}

export const useListSelectionFocusStore = create<ListSelectionFocusState>((set, get) => ({
  focused: null,
  setFocused: (handle) => set({ focused: handle }),
  clearFocused: (id) => {
    if (get().focused?.id === id) set({ focused: null })
  },
}))

export function focusedListSelection(): ListSelectionHandle | null {
  return useListSelectionFocusStore.getState().focused
}
