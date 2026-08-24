import { normalizeRect } from './atlasEnclosure'
import type { AtlasShapeType } from './atlasShapeStyleStore'
import type { ShapePoint } from './useAtlasShapeDraw'

// The shape tool's own live preview while a drag is mid-gesture
// (useAtlasShapeDraw.ts's localStart/localCurrent): a wrapper-spanning
// SVG overlay, pointer-events disabled, the same pattern
// AtlasPencilLivePreview.tsx/AtlasEraserLiveTrail.tsx already
// established. Rectangle/ellipse render from the drag's normalized
// bounding box; arrow renders the raw (non-normalized) start->current
// line directly, since normalizing away direction would point every
// leftward/upward arrow the wrong way.
export function AtlasShapeLivePreview({ shapeType, stroke, strokeWidth, start, current }: {
  shapeType: AtlasShapeType
  stroke: string
  strokeWidth: number
  start: ShapePoint
  current: ShapePoint
}) {
  if (shapeType === 'arrow') {
    return (
      <svg data-testid="atlas-shape-preview" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        <line x1={start.x} y1={start.y} x2={current.x} y2={current.y} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
      </svg>
    )
  }
  const rect = normalizeRect(start, current)
  return (
    <svg data-testid="atlas-shape-preview" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {shapeType === 'rectangle' ? (
        <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
      ) : (
        <ellipse cx={rect.x + rect.width / 2} cy={rect.y + rect.height / 2} rx={rect.width / 2} ry={rect.height / 2} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
      )}
    </svg>
  )
}
