export interface OverlapBox {
  id: string
  x: number
  y: number
  width: number
  height: number
  // A region frame participates in every resolution; a leaf-leaf
  // overlap is the user's own placement and is never touched.
  isFrame: boolean
}

export interface OverlapMove {
  id: string
  x: number
  y: number
}

const GAP = 12
const MAX_PASSES = 24

// Minimal-displacement overlap separation for Free-mode boards (goal
// 0073, VPSC-family: Dwyer/Marriott/Stuckey's Fast Node Overlap
// Removal is the published shape -- alternate-axis separation
// minimizing displacement, preserving relative order). Deliberately a
// small deterministic iterative variant rather than the full quadratic
// program or a force simulation: a board has tens of cards, not
// thousands, and determinism (same input, same nudge) matters more
// than optimality.
//
// The one product rule encoded here: A REGION FRAME NEVER OVERLAPS
// ANYTHING. Frames grow with their children (derived size), so a
// yesterday-clear layout can overlap today with nobody having moved a
// card -- those collisions auto-resolve. A leaf-on-leaf overlap is
// hand placement and is left exactly where the user put it.
export function resolveFreeOverlaps(boxes: OverlapBox[]): OverlapMove[] {
  const work = boxes.map((b) => ({ ...b }))
  // Stable processing order: by id, so the same board always nudges
  // the same cards the same way.
  work.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false
    for (let i = 0; i < work.length; i++) {
      for (let j = i + 1; j < work.length; j++) {
        const a = work[i]
        const b = work[j]
        if (!a.isFrame && !b.isFrame) continue
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
        if (overlapX <= 0 || overlapY <= 0) continue
        // Separate along the axis needing the smaller push; move the
        // box whose centre sits later along that axis (ties break by
        // the stable order), preserving relative arrangement.
        const pushX = overlapX + GAP
        const pushY = overlapY + GAP
        const aCx = a.x + a.width / 2
        const bCx = b.x + b.width / 2
        const aCy = a.y + a.height / 2
        const bCy = b.y + b.height / 2
        if (pushX <= pushY) {
          const target = bCx >= aCx ? b : a
          target.x += pushX
        } else {
          const target = bCy >= aCy ? b : a
          target.y += pushY
        }
        moved = true
      }
    }
    if (!moved) break
  }

  const byID = new Map(boxes.map((b) => [b.id, b]))
  return work
    .filter((w) => {
      const orig = byID.get(w.id)
      return orig !== undefined && (orig.x !== w.x || orig.y !== w.y)
    })
    .map((w) => ({ id: w.id, x: w.x, y: w.y }))
}
