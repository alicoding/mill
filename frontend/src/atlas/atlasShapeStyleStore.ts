import { create } from 'zustand'
import { PENCIL_COLORS } from './atlasPencilStyleStore'

// The shape tool's own "current defaults" cache (goal 0169 slice 5's
// own styleDefaults dual model, mirroring pencilStyleStore.ts): seeds
// the NEXT shape's type/stroke/width. Deliberately in-memory only -- no
// persist middleware, no backend call -- so a fresh session starts back
// at the defaults below rather than resurrecting a prior session's
// choice as if it were saved content. A drawn shape's OWN style instead
// lives in its BoardObject.Payload (atlasTools.ts's shapeTool.commit),
// which IS persisted document data -- this store is never read back
// from there. Reuses PENCIL_COLORS rather than a second stroke palette,
// since both pickers offer the same swatch set.
export type AtlasShapeType = 'rectangle' | 'ellipse' | 'arrow'
export const SHAPE_STROKE_WIDTHS = [1, 2, 4] as const
// Every new shape starts unfilled -- the converged default across
// Excalidraw/tldraw/draw.io's own basic shape (docs/goals/0169's own
// research); a filled-vs-transparent picker is 0193's own style-editor
// scope, not this slice's.
export const SHAPE_DEFAULT_FILL = 'transparent'

interface ShapeStyleState {
  shapeType: AtlasShapeType
  stroke: string
  strokeWidth: number
  setShapeType: (shapeType: AtlasShapeType) => void
  setStroke: (stroke: string) => void
  setStrokeWidth: (strokeWidth: number) => void
}

export const useAtlasShapeStyle = create<ShapeStyleState>()((set) => ({
  shapeType: 'rectangle',
  stroke: PENCIL_COLORS[0],
  strokeWidth: SHAPE_STROKE_WIDTHS[1],
  setShapeType: (shapeType) => set({ shapeType }),
  setStroke: (stroke) => set({ stroke }),
  setStrokeWidth: (strokeWidth) => set({ strokeWidth }),
}))
