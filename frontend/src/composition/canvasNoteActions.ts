import { createContext, useContext } from 'react'

// Threads a note card's own text/color edits down to the per-mount
// canvas store (CompositionCanvas.tsx creates one via createCanvasStore,
// docs/goals/0055) without CanvasNoteView needing a prop drilled through
// React Flow's own NodeProps -- the same context-over-per-node-prop
// shape breakpoints.ts's BreakpointContext already established for the
// step card's own debug toggle.
export interface NoteActionsContextValue {
  readOnly: boolean
  updateText: (id: string, text: string) => void
  updateColor: (id: string, color: string) => void
}

export const NoteActionsContext = createContext<NoteActionsContextValue>({
  readOnly: true,
  updateText: () => {},
  updateColor: () => {},
})

export function useNoteActions(): NoteActionsContextValue {
  return useContext(NoteActionsContext)
}
