import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { registerFlusher } from '../shared/flushRegistry'
import { useSaveMode } from '../shared/saveMode'
import { resolveNoteCommitText } from './atlasCreateHelpers'
import { refreshAtlas } from './atlasStore'
import { buildStickyNodes } from './atlasStickyNodes'
import type { AtlasStickyRFNode } from './AtlasStickyNode'
import { background } from '../shared/background'

// The board's sticky-note nodes plus explicit save mode's held edits
// (goal 0295 S2b). In automatic mode a click-away commits a note
// (useAtlasCreation's commitNoteEdit) and this hook is a plain memo
// over buildStickyNodes. In explicit mode a click-away HOLDS the text
// instead: the note leaves its edit session showing the held text
// with a dirty marker, and the held text lives here -- one registry
// entry per held note, whose flush is the real write (⌘S with nothing
// focused, the leave sheet's Save all) and whose discard drops it
// back to the saved text. A held note being re-edited hands its text
// to the editor (the node seeds from note.Text, which the overlay
// below has already replaced) and is NOT registered while the session
// runs -- the node's own live entry owns the flush then, so one save
// never races another for the same note.
//
// A never-saved draft note stays outside this: its placement is the
// capture (goal 0081), so a click-away creates it in either mode.
export function useAtlasStickyNodes({
  notes, draftNotePos, editingNoteID, readOnly, isSoleSelected, onCommitDraft, onCancelDraft, onEnterEdit, onCancelEdit, onCommitEdit, onOpenNote,
}: {
  notes: Note[]
  draftNotePos: { x: number; y: number } | null
  editingNoteID: string | null
  readOnly: boolean
  isSoleSelected: (id: string) => boolean
  onCommitDraft: (text: string) => void
  onCancelDraft: () => void
  onEnterEdit: (id: string) => void
  onCancelEdit: () => void
  onCommitEdit: (id: string, text: string) => void
  onOpenNote: (id: string) => void
}): AtlasStickyRFNode[] {
  const saveMode = useSaveMode()
  const [held, setHeld] = useState<Map<string, string>>(() => new Map())

  // A held text that now matches the saved note (its save landed) or
  // whose note is gone is no longer unsaved.
  useEffect(() => {
    setHeld((prev) => {
      if (prev.size === 0) return prev
      const next = new Map(prev)
      prev.forEach((text, id) => {
        const note = notes.find((n) => n.ID === id)
        if (!note || note.Text === text) next.delete(id)
      })
      return next.size === prev.size ? prev : next
    })
  }, [notes])

  const dropHeld = useCallback((id: string) => {
    setHeld((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  const saveNote = useCallback((id: string, text: string): Promise<void> => {
    const toPersist = resolveNoteCommitText(text)
    if (toPersist === null) return Promise.resolve()
    return AtlasService.UpdateNoteText(id, toPersist).then(() => refreshAtlas())
  }, [])

  useEffect(() => {
    const offs: (() => void)[] = []
    held.forEach((text, id) => {
      if (id === editingNoteID) return
      offs.push(registerFlusher(`note:${id}`, {
        flush: () => saveNote(id, text).then(() => dropHeld(id)),
        discard: () => dropHeld(id),
      }))
    })
    return () => offs.forEach((off) => off())
  }, [held, editingNoteID, saveNote, dropHeld])

  const holdEdit = useCallback((id: string, text: string) => {
    onCancelEdit()
    const note = notes.find((n) => n.ID === id)
    if (!note || note.Text === text) {
      dropHeld(id)
      return
    }
    setHeld((prev) => new Map(prev).set(id, text))
  }, [notes, onCancelEdit, dropHeld])

  // ⌘S mid-edit: the write, session kept; the text just saved is by
  // definition no longer held.
  const onSaveEdit = useCallback((id: string, text: string) => {
    dropHeld(id)
    void background(saveNote(id, text), 'atlasStickyNodes.saveEdit')
  }, [saveNote, dropHeld])

  const commit = saveMode === 'explicit' ? holdEdit : onCommitEdit

  const shownNotes = useMemo(
    () => (held.size === 0 ? notes : notes.map((n) => (held.has(n.ID) ? { ...n, Text: held.get(n.ID) ?? n.Text } : n))),
    [notes, held],
  )
  const dirtyIDs = useMemo(() => new Set(held.keys()), [held])

  return useMemo(() => buildStickyNodes({
    notes: shownNotes, dirtyIDs, draftNotePos, editingNoteID, readOnly, isSoleSelected,
    onCommitDraft, onCancelDraft, onEnterEdit, onCancelEdit, onCommitEdit: commit, onSaveEdit, onOpenNote,
  }), [shownNotes, dirtyIDs, draftNotePos, editingNoteID, readOnly, isSoleSelected, onCommitDraft, onCancelDraft, onEnterEdit, onCancelEdit, commit, onSaveEdit, onOpenNote])
}
