import { createContext, useContext } from 'react'

// Drag filing's release-target highlight (goal 0081 slice A2), carried
// as a narrowly-scoped channel of its own (goal 0161 slice 1) rather
// than as a `builtNodes` memo dependency: a frame boundary crossing
// during a drag used to invalidate that memo's fresh `data` object for
// EVERY board node, defeating every node's own memo() at the exact
// moment a drag is trying to settle. Only AtlasGroupNode reads this --
// a crossing now re-renders frame nodes only, never cards or notes.
export const AtlasDragHighlightContext = createContext<string | null>(null)

export function useAtlasDragHighlight(): string | null {
  return useContext(AtlasDragHighlightContext)
}
