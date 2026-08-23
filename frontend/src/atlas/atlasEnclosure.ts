// The marker-box's own pure geometry (goal 0081 slice A2, LOCKED
// design section 2's "draw around"): a marquee rectangle drawn while
// the Area tool is armed, and which top-level cards it counts as
// enclosed. Kept dependency-free the way atlasOverlapResolution.ts's
// own collision math is, so it's Vitest-unit-testable without a React
// render or a React Flow instance.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface EnclosureBox {
  id: string
  x: number
  y: number
  width: number
  height: number
}

// normalizeRect turns two arbitrary drag corners (the pointer can move
// in any direction from mousedown) into a rect with a non-negative
// width/height, the shape every consumer below expects.
export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

// enclosedIDs is the marker-box's own membership rule: a box counts as
// enclosed when its bounding-box CENTER -- not its full extent --
// falls inside rect. A card only partially covered by the drag still
// counts, matching the marquee-select convention every surveyed canvas
// tool (Excalidraw, tldraw, FigJam) already uses, so "draw around" and
// "select then group" (an actual multi-select) agree on the same rule.
export function enclosedIDs(rect: Rect, boxes: EnclosureBox[]): string[] {
  return boxes
    .filter((b) => {
      const cx = b.x + b.width / 2
      const cy = b.y + b.height / 2
      return cx >= rect.x && cx <= rect.x + rect.width && cy >= rect.y && cy <= rect.y + rect.height
    })
    .map((b) => b.id)
}

// The eraser tool's own hit test (goal 0169 slice 4): a box counts as
// TOUCHED when the point itself -- not its center, unlike enclosedIDs
// above -- lands anywhere inside the box's bounds. A real eraser
// removes what it visibly passes over, not just what's mostly covered;
// enclosedIDs' center rule is a marquee-SELECT convention (Excalidraw/
// tldraw/FigJam all use it for that), not an erase one.
export function pointHitIDs(point: { x: number; y: number }, boxes: EnclosureBox[]): string[] {
  return boxes
    .filter((b) => point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height)
    .map((b) => b.id)
}
