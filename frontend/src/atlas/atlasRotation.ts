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
