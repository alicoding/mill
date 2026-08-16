const MARGIN = 16
const STEP = 32
const MAX_ATTEMPTS = 64

interface NodeDims {
  width: number
  height: number
}

// Both positions are top-left corners (React Flow's own convention,
// what every caller already stores) -- axis-aligned box overlap with
// each box's OWN width/height, not a shared uniform one (a region
// frame's real footprint is far larger than a leaf note's). Reduces to
// the original single-dims formula exactly when aDims === bDims.
function overlaps(a: { x: number; y: number }, aDims: NodeDims, b: { x: number; y: number }, bDims: NodeDims) {
  const xOverlap = a.x < b.x + bDims.width + MARGIN && b.x < a.x + aDims.width + MARGIN
  const yOverlap = a.y < b.y + bDims.height + MARGIN && b.y < a.y + aDims.height + MARGIN
  return xOverlap && yOverlap
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
// existing is typed structurally (only .position/.dims is read) rather
// than any one caller's own node type -- shared/ so both Composition's
// workflow-node canvas and Atlas's card board (each with their own
// card/node footprint) reuse the identical spiral rather than each
// hand-rolling a copy; dims is the NEW node's own footprint (the
// caller's default, since most nodes on a board share one size). Each
// existing entry may carry its own dims override (falling back to
// dims when absent) -- Atlas needs this since a region frame's real
// footprint is far larger than a leaf note's; Composition's uniform
// workflow-step nodes never set it, so every existing call site keeps
// working unchanged.
export function findFreeDropPosition(
  desired: { x: number; y: number },
  existing: { position: { x: number; y: number }; dims?: NodeDims }[],
  dims: NodeDims,
) {
  const dimsOf = (n: { dims?: NodeDims }) => n.dims ?? dims
  if (!existing.some((n) => overlaps(desired, dims, n.position, dimsOf(n)))) return desired
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const angle = i * 2.4 // golden-angle-ish step so the spiral doesn't repeat a direction
    const radius = STEP * Math.sqrt(i)
    const candidate = { x: desired.x + radius * Math.cos(angle), y: desired.y + radius * Math.sin(angle) }
    if (!existing.some((n) => overlaps(candidate, dims, n.position, dimsOf(n)))) return candidate
  }
  return desired
}
