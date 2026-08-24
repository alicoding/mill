import type { Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { STICKY_HEIGHT, STICKY_WIDTH } from './atlasBoardLayout'
import type { AtlasStickyRFNode } from './AtlasStickyNode'

// Builds every sticky-note React Flow node for the current board:
// each persisted Note plus, when present, ONE draft node (an
// in-progress N-tool placement, not yet a real Note -- id !== any real
// note's, note: null in its data). Split out of AtlasBoard.tsx so its
// own builtNodes memo stays a thin composition of card + sticky nodes
// (architecture.md's 500-line convention).
export function buildStickyNodes({
  notes, draftNotePos, editingNoteID, readOnly, isSoleSelected, onCommitDraft, onCancelDraft, onEnterEdit, onCancelEdit, onCommitEdit, onOpenNote,
}: {
  notes: Note[]
  draftNotePos: { x: number; y: number } | null
  editingNoteID: string | null
  readOnly: boolean
  // The click model's own commit test (goal 0102's gesture table) --
  // see useAtlasSelection.ts's own header comment.
  isSoleSelected: (id: string) => boolean
  onCommitDraft: (text: string) => void
  onCancelDraft: () => void
  onEnterEdit: (id: string) => void
  onCancelEdit: () => void
  onCommitEdit: (id: string, text: string) => void
  onOpenNote: (id: string) => void
}): AtlasStickyRFNode[] {
  // The box never moves on entering/leaving edit (goal 0193: no
  // automatic resize, ever) -- every existing note always carries its
  // own persisted-or-default footprint, editing included. Only the
  // still-unpersisted draft below (no prior size to preserve) grows to
  // its content.
  const nodes: AtlasStickyRFNode[] = notes.map((note) => ({
    id: note.ID,
    type: 'atlas-sticky',
    position: { x: note.Position.X, y: note.Position.Y },
    width: note.Size?.W ?? STICKY_WIDTH,
    height: note.Size?.H ?? STICKY_HEIGHT,
    draggable: !readOnly && editingNoteID !== note.ID,
    data: {
      note,
      editing: editingNoteID === note.ID,
      isSoleSelected,
      onCommit: (text: string) => onCommitEdit(note.ID, text),
      onCancelEdit,
      onEnterEdit: () => onEnterEdit(note.ID),
      onOpenBig: () => onOpenNote(note.ID),
    },
  }))
  if (draftNotePos) {
    nodes.push({
      id: '__atlas-sticky-draft__',
      type: 'atlas-sticky',
      position: draftNotePos,
      draggable: false,
      data: {
        note: null,
        editing: true,
        isSoleSelected,
        onCommit: onCommitDraft,
        onCancelEdit: onCancelDraft,
        onEnterEdit: () => {},
        onOpenBig: () => {},
      },
    })
  }
  return nodes
}
