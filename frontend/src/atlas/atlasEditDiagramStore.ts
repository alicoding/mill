import { create } from 'zustand'

// Which board object's embedded editor engine is currently open (goal
// 0237 S1) -- a single id, never a stack, since only one editor dialog
// can be on screen at a time (AtlasView.tsx's own near-full-window
// modal). Mirrors atlasShapeRotateLiveStore.ts's own shape: a small,
// directly-imported store rather than prop-drilled state, so both the
// board-object node's double-click (AtlasBoardObjectNode.tsx) and the
// context-menu item (useAtlasObjectMenu.ts) can open it without
// threading a callback through atlasBuildBoardObjectNodes.ts's React
// Flow node data.
interface AtlasEditDiagramState {
  openObjectID: string | null
  open: (objectID: string) => void
  close: () => void
}

export const useAtlasEditDiagramStore = create<AtlasEditDiagramState>()((set) => ({
  openObjectID: null,
  open: (objectID) => set({ openObjectID: objectID }),
  close: () => set({ openObjectID: null }),
}))

export function openAtlasEditDiagram(objectID: string): void {
  useAtlasEditDiagramStore.getState().open(objectID)
}

export function closeAtlasEditDiagram(): void {
  useAtlasEditDiagramStore.getState().close()
}
