// Pure angle math for the shape rotation handle (goal 0214) -- kept
// framework-free so it's covered by a plain Vitest suite rather than
// needing a mounted component. Degrees, clockwise-positive, 0deg means
// "pointer directly above center" -- the handle's own rest position,
// matching the converged rotate-handle convention (draw.io, Figma,
// Excalidraw all treat the handle's own resting spot as the 0deg
// reading).
export function angleFromCenter(center: { x: number; y: number }, pointer: { x: number; y: number }): number {
  const dx = pointer.x - center.x
  const dy = pointer.y - center.y
  return (Math.atan2(dx, -dy) * 180) / Math.PI
}

// snapAngle -- rounds to the nearest multiple of step (Shift-held
// drag, draw.io's own 15deg convention).
export function snapAngle(angle: number, step: number): number {
  return Math.round(angle / step) * step
}

// normalizeAngle -- folds any angle (including the negative range
// atan2 returns) into [0, 360), so a persisted/exported value is
// always the same canonical reading regardless of which way the drag
// wrapped around.
export function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360
}

// rotatedAABB -- the axis-aligned box a w x h rectangle actually
// occupies once rotated `degrees` around its own center, expressed in
// the same (x, y) top-left + width/height shape every unrotated box on
// this board already uses (goal 0236's audit: eraser/laser hit-testing
// reads this instead of a shape node's raw measured size, which
// under-covers a rotated shape's real screen footprint). Degenerates
// to the identity box at 0deg, matching every pre-existing caller's
// unrotated math exactly.
export function rotatedAABB(x: number, y: number, w: number, h: number, degrees: number): { x: number; y: number; width: number; height: number } {
  if (!degrees) return { x, y, width: w, height: h }
  const rad = (degrees * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const width = w * cos + h * sin
  const height = w * sin + h * cos
  return { x: x + w / 2 - width / 2, y: y + h / 2 - height / 2, width, height }
}
