import { useEffect } from 'react'
import { Events } from '@wailsio/runtime'
import { flushAll, pendingFlushCount } from '../shared/flushRegistry'
import { getSaveMode, loadSaveMode } from '../shared/saveMode'
import { useUISignalStore } from '../shared/uiSignalStore'
import { flushScratchWrites } from '../composition/canvasScratch'

// The leave handshake's page half (goal 0295 S2; Go half in
// settingsservice_flush.go): Go emits mill-before-quit {reason}, the
// page settles every live edit and answers mill-flushed with whether
// to proceed. In automatic mode the settle IS the save -- the
// registry's flushers run, the canvas's debounced drafts are written,
// and the answer is yes. In explicit mode with unsaved edits the page
// answers mill-quit-held first, opens the Save all / Discard / Cancel
// sheet (UnsavedChangesDialog.tsx), and the sheet's choice sends the
// final answer through answerLeave. Only the main window holds edits,
// so only App mounts this.
const FLUSH_BOUND_MS = 1500

export type LeaveReason = 'quit' | 'restart' | 'close'

function reasonOf(data: unknown): LeaveReason {
  const r = (data as { reason?: unknown } | null)?.reason
  return r === 'restart' || r === 'close' ? r : 'quit'
}

// The sheet's answer: clears the sheet and tells Go whether to go on.
export function answerLeave(proceed: boolean): void {
  useUISignalStore.getState().clearUnsavedLeave()
  void Events.Emit('mill-flushed', proceed)
}

export function useBeforeQuitFlush(): void {
  useEffect(() => {
    void loadSaveMode()
    return Events.On('mill-before-quit', (ev) => {
      flushScratchWrites()
      if (getSaveMode() === 'explicit' && pendingFlushCount() > 0) {
        // A re-prompt while the sheet is already up (a second ⌘Q) just
        // re-confirms the hold; the sheet stays where it is.
        void Events.Emit('mill-quit-held', true)
        useUISignalStore.getState().requestUnsavedLeave(reasonOf(ev?.data))
        return
      }
      void flushAll(FLUSH_BOUND_MS).finally(() => {
        void Events.Emit('mill-flushed', true)
      })
    })
  }, [])
}
