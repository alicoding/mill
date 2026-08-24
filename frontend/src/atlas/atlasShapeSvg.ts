import type { AtlasShapeType } from './atlasShapeStyleStore'

export interface ShapeStyle { fill: string; stroke: string; strokeWidth: number }

// A rectangle/ellipse's own bounding box IS its persisted BoardObject.Size
// (W/H) -- geometry needs no helper beyond a floor so a near-zero-extent
// drag still leaves a selectable/visible footprint. Matches arrowGeometry's
// own 8px floor below for visual consistency across all three shapes.
export function boxDimensions(dx: number, dy: number): { w: number; h: number } {
  return { w: Math.max(8, Math.abs(dx)), h: Math.max(8, Math.abs(dy)) }
}

export interface ArrowGeometry { w: number; h: number; x1: number; y1: number; x2: number; y2: number }

// An arrow's own bounding box is derived purely from Payload.dx/dy
// (the vector from BoardObject.Position, its start point, to the end
// point) -- never stored separately, so create-time and render-time
// stay a single source of truth. Floored per axis at 4x strokeWidth so
// a perfectly horizontal/vertical arrow still gets a real cross-axis
// box for its own arrowhead marker to render inside (the <svg> itself
// renders with CSS overflow:visible, so a marker or thick stroke
// bleeding a few px past this nominal box is never clipped -- the floor
// only has to be "big enough to look intentional", not exact).
export function arrowGeometry(dx: number, dy: number, strokeWidth: number): ArrowGeometry {
  const floor = Math.max(strokeWidth * 4, 8)
  const w = Math.max(Math.abs(dx), floor)
  const h = Math.max(Math.abs(dy), floor)
  const x1 = dx < 0 ? w : 0
  const y1 = dy < 0 ? h : 0
  return { w, h, x1, y1, x2: x1 + dx, y2: y1 + dy }
}

// Payload's own wire shape (goal 0179's Payload map[string]string
// contract): every value stays a plain string, matching how
// Card.Fields already carries data against typedfield.Field.
export function shapePayload(shapeType: AtlasShapeType, style: ShapeStyle, title: string, extra?: { dx: number; dy: number }): Record<string, string> {
  const base: Record<string, string> = {
    shapeType, fill: style.fill, stroke: style.stroke, strokeWidth: String(style.strokeWidth), title,
  }
  if (extra) {
    base.dx = String(extra.dx)
    base.dy = String(extra.dy)
  }
  return base
}

export function shapeTitle(shapeType: AtlasShapeType): string {
  if (shapeType === 'rectangle') return 'Rectangle'
  if (shapeType === 'ellipse') return 'Ellipse'
  return 'Arrow'
}
