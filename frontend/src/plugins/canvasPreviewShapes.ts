import type { CanvasPreviewDecl, CanvasPreviewShape } from './sdk/canvasTools'

// What the host actually draws for a framed tool's live preview
// (docs/goals/0380 Decision 1), derived from the in-progress draft's
// own data. Pure: one declaration plus one data record in, a list of
// primitives out, so the whole vocabulary is unit-testable without a
// board, a frame or a pointer.

// Geometry encodings, one per primitive -- parsed from the draft's own
// data, never matched: a malformed value draws nothing rather than
// half a shape.
export function numbers(value: string | undefined, count: number): number[] | null {
  if (!value) return null
  const parts = value.split(',').map((p) => Number(p.trim()))
  if (parts.length !== count || parts.some((n) => !Number.isFinite(n))) return null
  return parts
}

export interface Paint { fill?: string; stroke?: string; strokeWidth?: string; opacity?: string }

export function paintProps(paint: Paint): Record<string, string | number> {
  const out: Record<string, string | number> = { fill: paint.fill ?? 'none' }
  if (paint.stroke) out.stroke = paint.stroke
  if (paint.strokeWidth) out.strokeWidth = Number(paint.strokeWidth) || 0
  if (paint.opacity) out.opacity = Number(paint.opacity)
  out.strokeLinecap = 'round'
  return out
}

// A 'shapes' preview's list is JSON in one data key -- parsed through
// JSON.parse and then field-checked, so a plugin cannot smuggle a
// non-primitive past the drawing code.
function parseShapeList(raw: string | undefined): CanvasPreviewShape[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const kinds = ['rect', 'ellipse', 'line', 'path']
  return parsed.flatMap((entry): CanvasPreviewShape[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const e = entry as Record<string, unknown>
    if (typeof e.kind !== 'string' || !kinds.includes(e.kind) || typeof e.geometry !== 'string') return []
    const paint: Paint = {}
    for (const key of ['fill', 'stroke', 'strokeWidth', 'opacity'] as const) {
      if (typeof e[key] === 'string') paint[key] = e[key] as string
    }
    return [{ kind: e.kind as CanvasPreviewShape['kind'], geometry: e.geometry, ...paint }]
  })
}

// previewShapes turns one draft plus its tool's declaration into the
// list of primitives to draw: a single-shape kind reads its geometry
// and paint from the named data keys; 'shapes' reads a whole list from
// one key, each part carrying its own paint.
export function previewShapes(decl: CanvasPreviewDecl, data: Record<string, string>): CanvasPreviewShape[] {
  if (decl.kind === 'shapes') return parseShapeList(data[decl.from])
  const geometry = data[decl.from]
  if (!geometry) return []
  return [{
    kind: decl.kind,
    geometry,
    fill: decl.fill ? data[decl.fill] : undefined,
    stroke: decl.stroke ? data[decl.stroke] : undefined,
    strokeWidth: decl.strokeWidth ? data[decl.strokeWidth] : undefined,
    opacity: decl.opacity ? data[decl.opacity] : undefined,
  }]
}

