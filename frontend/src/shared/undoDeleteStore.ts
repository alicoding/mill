import { create } from 'zustand'

// Configure's delete-undo signal (goal 0270): a page deletes an entity
// at once and posts the way back here; the app-level UndoDeleteToast
// renders whatever is pending, one at a time, for UNDO_DELETE_TOAST_MS.
// A newer delete replaces the toast; the replaced delete stays undoable
// server-side, just no longer offered.
export interface PendingUndoDelete {
  key: string
  message: string
  undo: () => Promise<void>
}

interface UndoDeleteState {
  pending: PendingUndoDelete | null
  show: (p: PendingUndoDelete) => void
  // dismiss(key) clears only that entry (a timer for a replaced toast
  // must not clear its successor); dismiss() clears whatever shows.
  dismiss: (key?: string) => void
}

export const UNDO_DELETE_TOAST_MS = 10_000

export const useUndoDeleteStore = create<UndoDeleteState>()((set) => ({
  pending: null,
  show: (p) => set({ pending: p }),
  dismiss: (key) => set((s) => (key === undefined || s.pending?.key === key ? { pending: null } : {})),
}))
