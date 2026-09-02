import { useEffect } from 'react'
import { Events } from '@wailsio/runtime'
import { flushAll } from '../shared/flushRegistry'
import { flushScratchWrites } from '../composition/canvasScratch'

// The quit / restart handshake's page half (goal 0295 S2): Go emits
// mill-before-quit, the page flushes every live edit (the registry's
// surfaces plus the canvas's debounced drafts) and answers
// mill-flushed; Go waits for the answer, bounded, then proceeds. Only
// the main window holds edits, so only App mounts this.
const FLUSH_BOUND_MS = 1500

export function useBeforeQuitFlush(): void {
  useEffect(() => {
    return Events.On('mill-before-quit', () => {
      flushScratchWrites()
      void flushAll(FLUSH_BOUND_MS).finally(() => {
        void Events.Emit('mill-flushed', true)
      })
    })
  }, [])
}
