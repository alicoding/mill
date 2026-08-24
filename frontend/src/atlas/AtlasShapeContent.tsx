import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { arrowGeometry } from './atlasShapeSvg'

const DEFAULT_W = 160
const DEFAULT_H = 100

// A shape's own persisted render (goal 0169 slice 5): unlike image/ink,
// this reads directly off BoardObject.Payload/Size -- no
// ObjectMirrorContent fetch, no mirror file at all, since fill/stroke/
// strokeWidth stay live data rather than baked bytes (atlasTools.ts's
// own shapeTool.commit comment explains why). overflow:visible on every
// <svg> below lets a thick stroke or an arrow's own marker bleed a few
// px past the nominal viewBox edge without being clipped, the same
// tradeoff atlasShapeSvg.ts's arrowGeometry comment documents.
export function AtlasShapeContent({ object }: { object: BoardObject }) {
  const payload = object.Payload ?? {}
  const shapeType = payload.shapeType
  const stroke = payload.stroke || '#1f6feb'
  const strokeWidth = Number(payload.strokeWidth) || 2
  const fill = payload.fill || 'none'

  if (shapeType === 'arrow') {
    const dx = Number(payload.dx) || 0
    const dy = Number(payload.dy) || 0
    const { w, h, x1, y1, x2, y2 } = arrowGeometry(dx, dy, strokeWidth)
    return (
      <svg data-testid="atlas-shape-content" width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible', display: 'block' }}>
        <defs>
          <marker id={`arrowhead-${object.ID}`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill={stroke} />
          </marker>
        </defs>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" markerEnd={`url(#arrowhead-${object.ID})`} />
      </svg>
    )
  }

  const w = object.Size?.W ?? DEFAULT_W
  const h = object.Size?.H ?? DEFAULT_H
  const inset = strokeWidth / 2

  return (
    <svg data-testid="atlas-shape-content" width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible', display: 'block' }}>
      {shapeType === 'ellipse' ? (
        <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - inset)} ry={Math.max(0, h / 2 - inset)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      ) : (
        <rect x={inset} y={inset} width={Math.max(0, w - strokeWidth)} height={Math.max(0, h - strokeWidth)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      )}
    </svg>
  )
}
