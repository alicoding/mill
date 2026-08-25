import { useEffect, useRef, useState } from 'react'
import type { TombstoneResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { useUISignalStore } from '../shared/uiSignalStore'

const TOAST_DURATION_MS = 10_000

export interface PendingUndo {
  cardIDs: string[]
  noteIDs: string[]
  // Board objects (goal 0179/0180) inherit the same undo door every
  // other Atlas delete already rides -- see AtlasService.DeleteBoardObject.
  objectIDs: string[]
  count: number
  linksRemoved: number
  childrenPromoted: number
}

// Owns the quick-delete undo toast's whole lifecycle (goal 0093): one
// pending delete at a time -- a later delete finalizes whatever was
// showing (client-side only: the earlier delete's entities stay
// tombstoned, only the toast itself is replaced), a 10s timer. Undoing
// -- whether by clicking the toast's button or by ⌘Z -- is the SAME
// journal pop every other mutation door rides (goal 0219 S2,
// ADR-0044): the button requests it via uiSignalStore's
// atlasUndoRequest (atlas/useAtlasUndoJournal owns the actual
// AtlasService.Undo() call + refresh), and this hook watches
// atlasUndoAppliedTick to dismiss the toast whenever an undo lands --
// via the button, ⌘Z, or the palette -- without re-deriving whether
// its own delete was the one that got undone (goal 0093's own
// contract: a later action always wins, so ANY applied undo/redo
// dismisses whatever toast is showing).
export function useAtlasUndoToast() {
  const [pending, setPending] = useState<PendingUndo | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const registerDelete = (result: TombstoneResult) => {
    clearTimer()
    const cardIDs = result.CardIDs ?? []
    const noteIDs = result.NoteIDs ?? []
    const objectIDs = result.ObjectIDs ?? []
    setPending({
      cardIDs,
      noteIDs,
      objectIDs,
      count: cardIDs.length + noteIDs.length + objectIDs.length,
      linksRemoved: result.LinksRemoved ?? 0,
      childrenPromoted: result.ChildrenPromoted ?? 0,
    })
    timerRef.current = setTimeout(() => setPending(null), TOAST_DURATION_MS)
  }

  const undo = () => {
    if (!pending) return
    clearTimer()
    setPending(null)
    useUISignalStore.getState().requestAtlasUndo()
  }

  useEffect(() => clearTimer, [])

  const appliedTick = useUISignalStore((s) => s.atlasUndoAppliedTick)
  const lastAppliedTick = useRef(appliedTick)
  useEffect(() => {
    if (appliedTick === lastAppliedTick.current) return
    lastAppliedTick.current = appliedTick
    clearTimer()
    setPending(null)
  }, [appliedTick])

  return { pending, registerDelete, undo }
}
