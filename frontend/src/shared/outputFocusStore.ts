import { create } from 'zustand'

// The focused output viewer (goal 0326). Every viewer control is a
// registry command (architecture.md: an action is a command with an
// honest enablement predicate, never an inline onClick), and a command
// lives at module scope with no way to reach the viewer the reader is
// looking at. So the viewer publishes a HANDLE while it holds focus,
// and output.copy / output.find / output.toggleWrap / output.openFull
// act on whatever handle is currently published -- the same
// store-field-beats-a-callback-chain seam shared/uiSignalStore.ts
// already uses for cross-tree signals.
//
// Exactly one handle at a time: focus is singular, so a second viewer
// taking focus replaces the first, and a viewer only clears the handle
// if it is still its own (blur and the next focus can arrive in either
// order).

export interface OutputViewerHandle {
  id: string
  // What Copy puts on the clipboard: the CURRENT view's text, so
  // copying a Table gives TSV and copying a Tree gives JSON.
  copyText: () => string
  toggleFind: () => void
  // Absent when the current view has nothing to wrap (Tree, Table,
  // Rendered) -- output.toggleWrap is disabled rather than silently
  // doing nothing.
  toggleWrap?: () => void
  // Absent when this viewer IS the full view.
  openFull?: () => void
}

interface OutputFocusState {
  focused: OutputViewerHandle | null
  setFocused: (handle: OutputViewerHandle) => void
  clearFocused: (id: string) => void
}

export const useOutputFocusStore = create<OutputFocusState>((set, get) => ({
  focused: null,
  setFocused: (handle) => set({ focused: handle }),
  clearFocused: (id) => {
    if (get().focused?.id === id) set({ focused: null })
  },
}))

export function focusedOutputViewer(): OutputViewerHandle | null {
  return useOutputFocusStore.getState().focused
}
