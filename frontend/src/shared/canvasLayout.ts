const MARGIN = 16
const STEP = 32
const MAX_ATTEMPTS = 64

interface NodeDims {
  width: number
  height: number
}

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }, dims: NodeDims) {
  return Math.abs(a.x - b.x) < dims.width + MARGIN && Math.abs(a.y - b.y) < dims.height + MARGIN
}

// A dropped node landing exactly on/near an existing one produced the
// stacked, unreadable mess in a bug report screenshot -- React Flow's
// own selection-outline math has no special case for near-identical
// bounding boxes, so it renders whatever the overlap happens to look
// like. Adapted from xyflow's own documented collision-avoidance example
// (reactflow.dev/examples/layout/node-collisions, same @xyflow/react
// dependency Mill already has -- not a new one), but simplified for the
// drop case specifically: only the one newly-dropped node needs placing,
// not a full pairwise resolve across every node on the canvas, so a
// cheap outward spiral search is enough.
// existing is typed structurally (only .position is read) rather than
// any one caller's own node type -- shared/ so both Composition's
// workflow-node canvas and Atlas's card canvas (each with their own
// card/node footprint) reuse the identical spiral rather than each
// hand-rolling a copy; dims is the caller's own node footprint, since
// the two callers' cards are not the same size.
export function findFreeDropPosition(desired: { x: number; y: number }, existing: { position: { x: number; y: number } }[], dims: NodeDims) {
  if (!existing.some((n) => overlaps(desired, n.position, dims))) return desired
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const angle = i * 2.4 // golden-angle-ish step so the spiral doesn't repeat a direction
    const radius = STEP * Math.sqrt(i)
    const candidate = { x: desired.x + radius * Math.cos(angle), y: desired.y + radius * Math.sin(angle) }
    if (!existing.some((n) => overlaps(candidate, n.position, dims))) return candidate
  }
  return desired
}
