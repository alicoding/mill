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

// Deterministic SIDE anchors (goal 0089, the draw-tool convention):
// each endpoint snaps to the midpoint of one of the rect's four
// sides, the side chosen by quantizing the center-to-center angle to
// a quadrant. A continuous boundary intersection slid along the card
// edge on every unrelated re-render ("jumpy"); a quantized side flips
// only when the partner actually crosses a quadrant boundary, so
// lines hold still and the arrange action operates on stable
// endpoints.
export function floatingEdgeEndpoints(source: Rect, target: Rect): EdgeEndpoints {
  const s = rectCenter(source)
  const t = rectCenter(target)
  const start = sideAnchor(source, s, t)
  const end = sideAnchor(target, t, s)
  return { sx: start.x, sy: start.y, tx: end.x, ty: end.y }
}

// The quadrant test normalizes by the rect's aspect so wide cards
// prefer their left/right faces exactly when the partner is beside
// them rather than above/below -- the same visual rule a person
// drawing the line by hand applies.
export function sideAnchor(rect: Rect, from: { x: number; y: number }, toward: { x: number; y: number }): { x: number; y: number } {
  const dx = toward.x - from.x
  const dy = toward.y - from.y
  const hw = rect.width / 2
  const hh = rect.height / 2
  if ((dx === 0 && dy === 0) || hw === 0 || hh === 0) return from
  if (Math.abs(dx) / hw >= Math.abs(dy) / hh) {
    return { x: from.x + (dx > 0 ? hw : -hw), y: from.y }
  }
  return { x: from.x, y: from.y + (dy > 0 ? hh : -hh) }
}

function rectCenter(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}

