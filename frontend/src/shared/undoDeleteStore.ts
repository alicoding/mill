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
  // The button's own label, whenever `undo` is set. Defaults to "Undo"
  // (undoDelete.undo) -- Secrets' own Move-to-Trash toast (goal 0406
  // S2) instead posts "Show Trash": that button navigates rather than
  // reversing anything, since the Trash itself is the way back, not
  // this toast.
  actionLabel?: string
  // The undo journal entry (ADR-0044) this toast offers a way back to
  // -- 'configure-entity'/`${entity}/${id}` for a Configure kind,
  // 'workflow'/id for a bulk workflow delete. Omitted for an action
  // (like Secrets' "Show Trash") that isn't a journal Undo at all --
  // the toast's own journal-advance watch (UndoDeleteToast.tsx) simply
  // never matches, so it stays up for its fixed timer like any
  // no-journal entry.
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
