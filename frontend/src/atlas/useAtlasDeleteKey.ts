import { useEffect, type RefObject } from 'react'
import { modalSurfaceOpen } from '../shared/modalGate'
import { runCommand } from '../shared/commands'
import { atlasSelectionContext } from '../shared/atlasSelectionStore'

// Delete/Backspace over a live board selection -> the shared
// delete path (quick-delete-with-undo for notes/objects, the confirm
// for cards; single or multi). Split out of AtlasBoard.tsx along its
// own effect seam (the 500-line convention). Never fires from
// editable elements, and stands down entirely while a modal dialog
// owns the screen (shared/modalGate.ts, the goal-0183 gesture-leak
// class): a Delete reaching the COVERED board would destroy a
// selection the user can't even see behind the dialog.
export function useAtlasDeleteKey({ selectedIDsRef }: { selectedIDsRef: RefObject<string[]> }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (modalSurfaceOpen()) return
      const el = document.activeElement
      if (el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
      const sel = selectedIDsRef.current
      if (sel.length === 0) return
      e.preventDefault()
      // The registry command over the live selection (goal 0346 slice
      // B) -- the same one the tray, every menu and the palette run.
      void runCommand('atlas.delete.selection', atlasSelectionContext())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedIDsRef])
}
