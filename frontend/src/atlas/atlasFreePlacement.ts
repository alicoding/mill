import { findFreeDropPosition } from '../shared/canvasLayout'

// A free spot among the board's MEASURED boxes (cards at their packed
// or dragged positions with their real frame sizes, notes, objects):
// what a creation door that has no pointer to land at -- the
// from-a-List table -- asks the board for. Stored positions alone miss
// packer-placed cards, which landed a new table under a seeded frame
// (goal 0287 S3).
export type FreePlacement = (size: { width: number; height: number }) => { X: number; Y: number }

const MARGIN = 16

function overlapsAny(spot: { x: number; y: number }, size: { width: number; height: number }, boxes: { x: number; y: number; width: number; height: number }[]): boolean {
  return boxes.some((b) => spot.x < b.x + b.width + MARGIN && b.x < spot.x + size.width + MARGIN && spot.y < b.y + b.height + MARGIN && b.y < spot.y + size.height + MARGIN)
}

export function freePositionAmong(boxes: { x: number; y: number; width: number; height: number }[], size: { width: number; height: number }): { X: number; Y: number } {
  const desired = { x: 80, y: 80 }
  const spot = findFreeDropPosition(desired, boxes.map((b) => ({ position: { x: b.x, y: b.y }, dims: { width: b.width, height: b.height } })), size)
  if (!overlapsAny(spot, size, boxes)) return { X: spot.x, Y: spot.y }
  // The spiral's reach is bounded and a crowded board can defeat it;
  // it then hands back the overlapping wish. With no pointer to honor,
  // land below everything instead -- always free, and where a reader
  // looks for the newest thing.
  const bottom = Math.max(...boxes.map((b) => b.y + b.height))
  return { X: desired.x, Y: bottom + MARGIN }
}
