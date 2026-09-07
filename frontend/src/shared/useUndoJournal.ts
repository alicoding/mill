import { useEffect, useRef } from 'react'
import { Events } from '@wailsio/runtime'
import { AtlasService } from './bindings'
import { useUISignalStore } from './uiSignalStore'
import { background } from './background'

// Owns the actor-scoped undo journal's frontend half (goal 0219 S2,
// ADR-0044): keeps uiSignalStore's atlasUndoAvailable/atlasRedoAvailable
// flags and atlasUndoTop in sync with the Go journal (polling
// AtlasService.UndoState() on every mill-data-changed event -- the same
// channel every other read surface already refreshes from; a List row
// edit made in a board table or a Configure entity delete journals
// under the same actor, goal 0352, so its availability arrives on
// whichever family channel the door emitted), and applies
// atlasUndoRequest/atlasRedoRequest ticks
// (bumped by the atlas.undo/atlas.redo commands, including the
// dedicated ⌘Z/⇧⌘Z listener in app/useKeymapDispatch.ts) by calling
// the matching RPC. Undo() and Redo() apply the inverse through the
// SAME doors that made the original change, and every door emits its
// own dataevent, so each surface's existing live refresh is all the
// frontend needs -- it never re-derives state itself. onApplied is the
// host's own extra refresh for state no dataevent covers (the board's
// atlas store); a host with none passes nothing.
// atlasUndoAppliedTick bumps on every successful apply regardless of
// trigger, so the delete toast (useAtlasUndoToast) can dismiss itself
// when ⌘Z resolves the exact delete it's showing. onSkip surfaces
// ADR-0044 decision 5's apply-time staleness notice through whatever
// quiet notice line the host already renders, never a new surface.
//
// ONE mount at a time: the journal is app-wide, and the surfaces that
// mount it (the board, ConfigureView) are alternative views of the same
// window, never both on screen at once.
export function useUndoJournal({ onSkip, onApplied }: { onSkip: (message: string) => void; onApplied?: () => void }) {
  const refreshState = () => {
    void background(AtlasService.UndoState()
      .then((s) => {
        const store = useUISignalStore.getState()
        store.setAtlasUndoRedoAvailable({ hasUndo: s.HasUndo, hasRedo: s.HasRedo })
        store.setAtlasUndoTop(s.TopKind ? { kind: s.TopKind, id: s.TopID } : null)
      }), 'undoJournal.undoState')
  }

  useEffect(() => {
    refreshState()
    return Events.On('mill-data-changed', () => refreshState())
  }, [])

  const apply = (call: () => Promise<{ Applied: boolean; Skipped: boolean; Message: string }>) => {
    void background(call()
      .then((res) => {
        if (res.Applied) {
          useUISignalStore.getState().bumpAtlasUndoApplied()
          onApplied?.()
        }
        if (res.Skipped) onSkip(res.Message)
        refreshState()
      }), 'undoJournal.apply')
  }

  // ⌘Z/⇧⌘Z are armed only while the journal has something to undo or
  // redo (app/useKeymapDispatch.ts reads the same two flags), and those
  // flags land asynchronously, one UndoState round trip after the
  // write's dataevent. These attributes are the only observable that
  // the shortcut is armed -- without them a press made right after an
  // edit races the poll and is silently swallowed.
  const hasUndo = useUISignalStore((s) => s.atlasUndoAvailable)
  const hasRedo = useUISignalStore((s) => s.atlasRedoAvailable)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.millUndo = hasUndo ? 'available' : 'none'
    root.dataset.millRedo = hasRedo ? 'available' : 'none'
    return () => {
      delete root.dataset.millUndo
      delete root.dataset.millRedo
    }
  }, [hasUndo, hasRedo])

  const undoRequest = useUISignalStore((s) => s.atlasUndoRequest)
  const lastUndoRequest = useRef(undoRequest)
  useEffect(() => {
    if (undoRequest === lastUndoRequest.current) return
    lastUndoRequest.current = undoRequest
    apply(AtlasService.Undo)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the signal tick alone
  }, [undoRequest])

  const redoRequest = useUISignalStore((s) => s.atlasRedoRequest)
  const lastRedoRequest = useRef(redoRequest)
  useEffect(() => {
    if (redoRequest === lastRedoRequest.current) return
    lastRedoRequest.current = redoRequest
    apply(AtlasService.Redo)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the signal tick alone
  }, [redoRequest])
}
