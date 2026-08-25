import { useEffect, useRef } from 'react'
import { Events } from '@wailsio/runtime'
import { AtlasService } from '../shared/bindings'
import { useUISignalStore } from '../shared/uiSignalStore'
import { refreshAtlas } from './atlasStore'

// Owns the actor-scoped undo journal's frontend half (goal 0219 S2,
// ADR-0044): keeps uiSignalStore's atlasUndoAvailable/atlasRedoAvailable
// flags in sync with the Go journal (polling AtlasService.UndoState()
// on every 'atlas' dataevent -- the same mill-data-changed channel
// every other Atlas read surface already refreshes from), and applies
// atlasUndoRequest/atlasRedoRequest ticks (bumped by the atlas.undo/
// atlas.redo commands, including the dedicated ⌘Z/⇧⌘Z listener in
// app/useKeymapDispatch.ts) by calling the matching RPC. Undo() and
// Redo() apply the inverse through the SAME AtlasService doors that
// made the original change, so a plain refreshAtlas() after either
// call is all the frontend ever needs -- it never re-derives state
// itself. atlasUndoAppliedTick bumps on every successful apply
// regardless of trigger, so the delete toast (useAtlasUndoToast) can
// dismiss itself when ⌘Z resolves the exact delete it's showing.
// onSkip surfaces ADR-0044 decision 5's apply-time staleness notice
// through the board's existing quiet-toast channel (useAtlasQuietToast)
// rather than a new surface -- same "reuse the multi-purpose surface"
// rule useAtlasQuietToast's own header already documents.
export function useAtlasUndoJournal({ onSkip }: { onSkip: (message: string) => void }) {
  const refreshState = () => {
    AtlasService.UndoState()
      .then((s) => useUISignalStore.getState().setAtlasUndoRedoAvailable({ hasUndo: s.HasUndo, hasRedo: s.HasRedo }))
      .catch(console.error)
  }

  useEffect(() => {
    refreshState()
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'atlas') refreshState()
    })
  }, [])

  const apply = (call: () => Promise<{ Applied: boolean; Skipped: boolean; Message: string }>) => {
    call()
      .then((res) => {
        if (res.Applied) {
          useUISignalStore.getState().bumpAtlasUndoApplied()
          void refreshAtlas()
        }
        if (res.Skipped) onSkip(res.Message)
        refreshState()
      })
      .catch(console.error)
  }

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
