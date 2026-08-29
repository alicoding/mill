import { useEffect, type RefObject } from 'react'
import type { Card, Note, BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { modalSurfaceOpen } from '../shared/modalGate'

// Delete/Backspace over a live board selection -> the shared
// delete path (quick-delete-with-undo for notes/objects, the confirm
// for cards; single or multi). Split out of AtlasBoard.tsx along its
// own effect seam (the 500-line convention). Never fires from
// editable elements, and stands down entirely while a modal dialog
// owns the screen (shared/modalGate.ts, the goal-0183 gesture-leak
// class): a Delete reaching the COVERED board would destroy a
// selection the user can't even see behind the dialog.
export function useAtlasDeleteKey({ cards, notes, objects, selectedIDsRef, onDeleteSelection }: {
  cards: Card[]
  notes: Note[]
  objects: BoardObject[]
  selectedIDsRef: RefObject<string[]>
  onDeleteSelection: (cardIDs: string[], noteIDs: string[], objectIDs?: string[]) => void
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (modalSurfaceOpen()) return
      const el = document.activeElement
      if (el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
      const sel = selectedIDsRef.current
      if (sel.length === 0) return
      e.preventDefault()
      const cardIDs = sel.filter((id) => cards.some((c) => c.ID === id))
      const noteIDs = sel.filter((id) => notes.some((n) => n.ID === id))
      const objectIDs = sel.filter((id) => objects.some((o) => o.ID === id))
      if (cardIDs.length + noteIDs.length + objectIDs.length > 0) onDeleteSelection(cardIDs, noteIDs, objectIDs)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cards, notes, objects, onDeleteSelection, selectedIDsRef])
}
