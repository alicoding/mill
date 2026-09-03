import type { Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { STICKY_WIDTH } from './atlasBoardLayout'
import type { AtlasStickyRFNode } from './AtlasStickyNode'

// Builds every sticky-note React Flow node for the current board:
// each persisted Note plus, when present, ONE draft node (an
// in-progress N-tool placement, not yet a real Note -- id !== any real
// note's, note: null in its data). Split out of AtlasBoard.tsx so its
// own builtNodes memo stays a thin composition of card + sticky nodes
// (architecture.md's 500-line convention).
export function buildStickyNodes({
  notes, dirtyIDs, draftNotePos, editingNoteID, readOnly, isSoleSelected, onCommitDraft, onCancelDraft, onEnterEdit, onCancelEdit, onCommitEdit, onSaveEdit, onOpenNote,
}: {
  notes: Note[]
  // Notes whose text is held unsaved (explicit save mode,
  // useAtlasStickyNodes.ts) -- rendered with the dirty marker.
  dirtyIDs: Set<string>
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
  // ⌘S mid-edit: the write without ending the session.
  onSaveEdit: (id: string, text: string) => void
  onOpenNote: (id: string) => void
}): AtlasStickyRFNode[] {
  // Width is the one RF-controlled dimension (persisted-or-default,
  // user-resizable); height is deliberately OMITTED here -- the note's
  // box height is content-driven (AtlasStickyNode.tsx's own inline
  // min-height + CSS auto-height), so React Flow measures the real
  // rendered height via its own ResizeObserver instead of this builder
  // clamping it to a stale value. Same box model, editing or at rest --
  // no snap between the two. The still-unpersisted draft below shares
  // this exact model, just with no prior Size to read.
  const nodes: AtlasStickyRFNode[] = notes.map((note) => ({
    id: note.ID,
    type: 'atlas-sticky',
    position: { x: note.Position.X, y: note.Position.Y },
    width: note.Size?.W ?? STICKY_WIDTH,
    draggable: !readOnly && editingNoteID !== note.ID,
    data: {
      note,
      editing: editingNoteID === note.ID,
      dirty: dirtyIDs.has(note.ID),
      isSoleSelected,
      onCommit: (text: string) => onCommitEdit(note.ID, text),
      onSave: (text: string) => onSaveEdit(note.ID, text),
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
      width: STICKY_WIDTH,
      draggable: false,
      data: {
        note: null,
        editing: true,
        dirty: false,
        isSoleSelected,
        onCommit: onCommitDraft,
        // A draft's save IS its creation -- the session ends with it.
        onSave: onCommitDraft,
        onCancelEdit: onCancelDraft,
        onEnterEdit: () => {},
        onOpenBig: () => {},
      },
    })
  }
  return nodes
}
