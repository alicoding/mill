import { create } from 'zustand'

// The focused List grid's action handle (goal 0349 S4 gap), the same
// focus-scoped shape output.find already established
// (outputFocusStore.ts): listGrid.search has no live selection to act
// on the way the bulk commands (listGridCommands.ts) do, only "act on
// whichever grid currently holds focus" -- and a registry command
// lives at module scope with no way to reach a specific mounted
// ListGridGlide's own state directly. A leaf file, never
// ListGridGlide.tsx itself: that component pulls in Glide Data Grid's
// CSS, which the unit-test (node) environment cannot resolve, and this
// store is exactly what listGridCommands.test.ts needs to drive
// without mounting a grid.
//
// insertColumn joins toggleSearch for the same reason: opening the new
// column's rename field is the mount's own local state
// (ListGridGlide.tsx's pendingRenameKey), which only that mount can
// drive -- a registry command with no mount to reach can append a
// column (a plain service call), but not also open its rename field.
//
// Exactly one handle at a time: focus is singular, so a second grid
// taking focus replaces the first, and a grid only clears the handle
// if it is still its own (blur and the next focus can arrive in either
// order).

export interface ListGridSearchHandle {
  id: string
  toggleSearch: () => void
  insertColumn: () => void
}

interface ListGridSearchFocusState {
  focused: ListGridSearchHandle | null
  setFocused: (handle: ListGridSearchHandle) => void
  clearFocused: (id: string) => void
}

export const useListGridSearchFocusStore = create<ListGridSearchFocusState>((set, get) => ({
  focused: null,
  setFocused: (handle) => set({ focused: handle }),
  clearFocused: (id) => {
    if (get().focused?.id === id) set({ focused: null })
  },
}))

export function focusedListGridSearch(): ListGridSearchHandle | null {
  return useListGridSearchFocusStore.getState().focused
}
