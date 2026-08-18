import { useCallback, useMemo } from 'react'
import type { NodeChange } from '@xyflow/react'
import type { CanvasStore, CanvasNode, CanvasNoteNode } from './canvasStore'
import { findFreeDropPosition } from '../shared/canvasLayout'
import { CANVAS_NODE_WIDTH, CANVAS_NODE_HEIGHT, CANVAS_NOTE_WIDTH, CANVAS_NOTE_HEIGHT } from './canvasConstants'
import type { NoteActionsContextValue } from './canvasNoteActions'
import { newLocalID } from '../shared/localId'

// Split out of CompositionCanvas.tsx at the 500-line limit (CLAUDE.md)
// -- the note-specific wiring docs/goals/0055 needs on top of the
// existing step canvas: rendering steps and notes as one React Flow
// `nodes` array (two node TYPES sharing one canvas) while keeping them
// in the canvas store's own separate `nodes`/`notes` slices (a note is
// not a step -- canvasStore.ts's own header comment).

export interface UseCanvasNotesResult {
  // Steps + notes concatenated -- what ReactFlow's own `nodes` prop
  // renders; canvasStore.ts's `nodes` slice (alone) is still what
  // every step-only concern (validation, guardrail badges, ELK layout,
  // Inspector selection) reads, unchanged by this hook's existence.
  allNodes: (CanvasNode | CanvasNoteNode)[]
  handleNodesChange: (changes: NodeChange<CanvasNode | CanvasNoteNode>[]) => void
  addNoteNear: (desired: { x: number; y: number }) => void
  noteActions: NoteActionsContextValue
}

export function useCanvasNotes(
  useCanvasStore: CanvasStore,
  nodes: CanvasNode[],
  notes: CanvasNoteNode[],
  readOnly: boolean,
): UseCanvasNotesResult {
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const onNotesChange = useCanvasStore((s) => s.onNotesChange)
  const addNote = useCanvasStore((s) => s.addNote)
  const updateNoteText = useCanvasStore((s) => s.updateNoteText)
  const updateNoteColor = useCanvasStore((s) => s.updateNoteColor)

  const allNodes = useMemo(() => [...nodes, ...notes], [nodes, notes])

  // React Flow's drag/select/resize/remove events all arrive through
  // ONE onNodesChange callback keyed by node id, regardless of which of
  // the two node types a given id belongs to -- split by id membership
  // so each change reaches the store slice that actually owns that id.
  const noteIds = useMemo(() => new Set(notes.map((n) => n.id)), [notes])
  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode | CanvasNoteNode>[]) => {
      const noteChanges = changes.filter((c) => 'id' in c && noteIds.has(c.id))
      const stepChanges = changes.filter((c) => !('id' in c) || !noteIds.has(c.id))
      if (stepChanges.length) onNodesChange(stepChanges as NodeChange<CanvasNode>[])
      if (noteChanges.length) onNotesChange(noteChanges as NodeChange<CanvasNoteNode>[])
    },
    [noteIds, onNodesChange, onNotesChange],
  )

  // The canvas toolbar's "Add note" button (docs/goals/0055) -- reuses
  // findFreeDropPosition's own spiral collision-avoidance (canvasLayout.ts)
  // against BOTH steps and existing notes, so a second/third note fanned
  // out from the same starting spot instead of stacking unreadably.
  const addNoteNear = useCallback(
    (desired: { x: number; y: number }) => {
      const position = findFreeDropPosition(desired, [...nodes, ...notes], { width: CANVAS_NODE_WIDTH, height: CANVAS_NODE_HEIGHT })
      addNote({
        id: newLocalID(),
        type: 'note',
        position,
        width: CANVAS_NOTE_WIDTH,
        height: CANVAS_NOTE_HEIGHT,
        data: { text: '', color: '' },
      })
    },
    [nodes, notes, addNote],
  )

  const noteActions = useMemo<NoteActionsContextValue>(
    () => ({ readOnly, updateText: updateNoteText, updateColor: updateNoteColor }),
    [readOnly, updateNoteText, updateNoteColor],
  )

  return { allNodes, handleNodesChange, addNoteNear, noteActions }
}
