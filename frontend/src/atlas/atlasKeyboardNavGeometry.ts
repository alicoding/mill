export interface NavBox { id: string; x: number; y: number; width: number; height: number }

// Reading order for Tab/Shift+Tab (goal 0104's key table): row-major,
// top-to-bottom then left-to-right -- the three-tool convergence the
// table cites. Rows are bucketed by vertical overlap (a box's own
// center falling within another's own vertical span counts as "the
// same row") rather than an exact Y match, since free-mode positions
// are hand-placed and rarely land on a shared pixel row.
export function readingOrder(boxes: NavBox[]): NavBox[] {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: NavBox[][] = []
  for (const box of sorted) {
    const cy = box.y + box.height / 2
    const row = rows.find((r) => cy >= r[0].y && cy <= r[0].y + r[0].height)
    if (row) row.push(box)
    else rows.push([box])
  }
  return rows.flatMap((row) => [...row].sort((a, b) => a.x - b.x))
}

export type NavDirection = 'up' | 'down' | 'left' | 'right'

// Option+Arrow's own directional focus (goal 0104's key table, tldraw's
// spatial nav): among every OTHER candidate, keep only the ones whose
// center actually lies in the requested direction from the current
// box's center (a ±45° cone around that axis, so "right" never picks a
// box that's really above), then return the nearest by straight-line
// distance. Returns null when nothing qualifies (the edge of the
// board in that direction).
export function nearestInDirection(current: NavBox, candidates: NavBox[], direction: NavDirection): NavBox | null {
  const cx = current.x + current.width / 2
  const cy = current.y + current.height / 2
  let best: NavBox | null = null
  let bestDist = Infinity
  for (const box of candidates) {
    if (box.id === current.id) continue
    const bx = box.x + box.width / 2
    const by = box.y + box.height / 2
    const dx = bx - cx
    const dy = by - cy
    if (dx === 0 && dy === 0) continue
    if (!inDirectionCone(dx, dy, direction)) continue
    const dist = Math.hypot(dx, dy)
    if (dist < bestDist) {
      bestDist = dist
      best = box
    }
  }
  return best
}

function inDirectionCone(dx: number, dy: number, direction: NavDirection): boolean {
  const angle = Math.atan2(dy, dx) // 0 = right, +90deg (PI/2) = down
  const diff = (a: number, b: number) => {
    let d = Math.abs(a - b) % (2 * Math.PI)
    if (d > Math.PI) d = 2 * Math.PI - d
    return d
  }
  const targets: Record<NavDirection, number> = {
    right: 0,
    down: Math.PI / 2,
    left: Math.PI,
    up: -Math.PI / 2,
  }
  return diff(angle, targets[direction]) <= Math.PI / 4
}
