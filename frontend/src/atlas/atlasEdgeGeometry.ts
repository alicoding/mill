export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface EdgeEndpoints {
  sx: number
  sy: number
  tx: number
  ty: number
}

// Where a straight link line meets each card's boundary, aimed
// center-to-center (React Flow's own floating-edges pattern): the
// segment from one rect's center toward the other's, clipped to the
// axis-aligned boundary by scaling the direction vector so its larger
// normalized component reaches the half-extent exactly. Keeps a link
// attached to whichever face of the card actually points at its
// partner, instead of the fixed handle points whose default bezier
// loops made links unreadable.
export function floatingEdgeEndpoints(source: Rect, target: Rect): EdgeEndpoints {
  const s = rectCenter(source)
  const t = rectCenter(target)
  const start = boundaryPoint(source, s, t)
  const end = boundaryPoint(target, t, s)
  return { sx: start.x, sy: start.y, tx: end.x, ty: end.y }
}

function rectCenter(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}

function boundaryPoint(rect: Rect, from: { x: number; y: number }, toward: { x: number; y: number }): { x: number; y: number } {
  const dx = toward.x - from.x
  const dy = toward.y - from.y
  const hw = rect.width / 2
  const hh = rect.height / 2
  // Coincident centers (fully overlapping cards) have no direction to
  // aim along -- degrade to the center itself rather than dividing by 0.
  const scale = Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh)
  if (scale === 0 || !Number.isFinite(scale)) return from
  return { x: from.x + dx / scale, y: from.y + dy / scale }
}
