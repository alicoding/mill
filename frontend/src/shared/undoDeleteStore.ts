import { create } from 'zustand'

// Configure's delete-undo signal (goal 0270): a page deletes an entity
// (or, since goal 0404 S1, a bulk selection of several) at once and
// posts the way back here; the app-level UndoDeleteToast renders
// whatever is pending, one at a time, for UNDO_DELETE_TOAST_MS. A newer
// delete replaces the toast; the replaced delete stays undoable
// server-side, just no longer offered.
export interface PendingUndoDelete {
  key: string
  message: string
  // null for a delete whose door registers no way back (Secrets, goal
  // 0404 S1's amendment) -- the toast then renders no Undo button at
  // all, rather than one that would always fail.
  undo: (() => Promise<void>) | null
  // The undo journal entry (ADR-0044) this toast offers a way back to
  // -- 'configure-entity'/`${entity}/${id}` for a Configure kind,
  // 'workflow'/id for a bulk workflow delete. Required whenever `undo`
  // is set: it's what lets the toast hide itself once the journal has
  // moved past this step (goal 0352 part 2), the same watch a single-
  // row delete's toast already does.
  journalKind?: string
  journalId?: string
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
