import type { FrameBox } from './useAtlasDragFiling'

// frameContainingPoint mirrors useAtlasDragFiling's own frameUnder --
// a point (rather than a dragged node's box) landing inside a
// top-level frame's own rendered bounds names that frame as the
// point's parent (LOCKED design §3b: "drop inside an area frame ->
// that frame"). Shared by every canvas-foremost capture door that
// resolves a parent from a screen point instead of a drag
// (useAtlasNativeFileDrop.ts, useAtlasPaste.ts) rather than each
// re-deriving the same hit test.
export function frameContainingPoint(boxes: FrameBox[], point: { x: number; y: number }): string | null {
  const hit = boxes.find((b) => b.isFrame && point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height)
  return hit?.id ?? null
}
