import { useEffect, useRef, useState } from 'react'
import { AtlasService } from '../shared/bindings'
import type { TombstoneResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { useUISignalStore } from '../shared/uiSignalStore'
import { refreshAtlas } from './atlasStore'

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
// tombstoned, only the toast itself is replaced), a 10s timer, a
// click, and ⌘Z (via the atlasUndoDeleteRequest signal a dedicated
// app/useKeymapDispatch.ts listener bumps) all resolve to the same
// undo() call. Keeps uiSignalStore's atlasUndoDeletePending flag in
// sync so that listener can guard without reaching into this
// component's own state (shared/ can't import atlas/, frontend.md's
// bounded-context rule).
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
    const { cardIDs, noteIDs, objectIDs } = pending
    setPending(null)
    void AtlasService.UndoDelete(cardIDs, noteIDs, objectIDs).then(() => refreshAtlas())
  }

  useEffect(() => clearTimer, [])

  useEffect(() => {
    useUISignalStore.getState().setAtlasUndoDeletePending(pending !== null)
  }, [pending])

  const undoDeleteRequest = useUISignalStore((s) => s.atlasUndoDeleteRequest)
  const lastUndoDeleteRequest = useRef(undoDeleteRequest)
  useEffect(() => {
    if (undoDeleteRequest === lastUndoDeleteRequest.current) return
    lastUndoDeleteRequest.current = undoDeleteRequest
    undo()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the signal tick alone; pending is read at fire time via the undo closure
  }, [undoDeleteRequest])

  return { pending, registerDelete, undo }
}
