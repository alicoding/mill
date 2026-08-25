import { normalizeRect } from './atlasEnclosure'
import { useAtlasShapeStyle } from './atlasStyleValueStore'
import type { AtlasGesturePoint } from './atlasNounRegistry'

// The shape tool's own gesture.preview (goal 0215 S2, absorbing goal
// 0169 slice 5's original component): a wrapper-spanning SVG overlay,
// pointer-events disabled, the same pattern AtlasPencilLivePreview.tsx/
// AtlasEraserLiveTrail.tsx already establish. start/current are the
// engine's own first/latest accumulated point -- rectangle/ellipse
// render from their normalized bounding box; arrow renders the raw
// (non-normalized) start->current line directly, since normalizing
// away direction would point every leftward/upward arrow the wrong
// way. Reads shapeType/stroke/strokeWidth straight off the style store
// (the same session cache the tool's own onEnd commits from) rather
// than taking them as props.
export function AtlasShapeLivePreview({ points }: { points: AtlasGesturePoint[]; now: number }) {
  const { shapeType, stroke, strokeWidth } = useAtlasShapeStyle()
  if (points.length < 1) return null
  const start = points[0], current = points[points.length - 1]
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
