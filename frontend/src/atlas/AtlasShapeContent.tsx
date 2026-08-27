import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { arrowGeometry } from './atlasShapeSvg'

const DEFAULT_W = 160
const DEFAULT_H = 100

// A shape's own persisted render (goal 0169 slice 5): unlike image/ink,
// this reads directly off BoardObject.Payload/Size -- no
// ObjectMirrorContent fetch, no mirror file at all, since fill/stroke/
// strokeWidth stay live data rather than baked bytes (atlasTools.ts's
// own shapeTool.commit comment explains why).
//
// The arrow branch keeps fixed pixel width/height + overflow:visible --
// its own geometry (atlasShapeSvg.ts's arrowGeometry) is a line plus a
// marker that legitimately bleeds a few px past the nominal viewBox
// edge, and an arrow carries no Size/resize at all (AtlasBoardObjectNode's
// own `resizable` carve-out), so there is no live-resize case to track.
//
// The rectangle/ellipse branch (goal 0206) instead fills its container:
// width/height 100% + preserveAspectRatio="none", geometry addressed
// through the viewBox alone. This is what keeps the paint from ever
// exceeding the node's own box (a fixed pixel width/height inside the
// shared 'atlas-object' renderer's flex content box was rendering past
// the node's bottom edge) AND makes a resize track the pointer live --
// NodeResizer only ever writes Size at onResizeEnd, so during a drag the
// node's own box already moves with the pointer while a fixed-pixel SVG
// stayed at the stale persisted Size until release. Filling the
// container means the paint scales with whatever box React Flow is
// currently rendering, live, with no separate write needed.
// mirrorVersion (goal 0232 S1's file-backed contract) is accepted but
// unused -- a shape bakes to no mirror file at all (fileBacked: false
// in tools/shapeTool.ts), so this Kind's own version counter never
// actually bumps.
export function AtlasShapeContent({ object }: { object: BoardObject; mirrorVersion: number }) {
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
  // Rotation (goal 0214, rectangle/ellipse only) is applied one level
  // up, on AtlasBoardObjectNode's own box (goal 0236) -- this SVG just
  // fills whatever box it's given, unrotated, so the selection ring/
  // resize handles/rotate handle share the exact same transform the
  // paint does rather than disagreeing with it.

  return (
    <svg
      data-testid="atlas-shape-content"
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      {shapeType === 'ellipse' ? (
        <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - inset)} ry={Math.max(0, h / 2 - inset)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      ) : (
        <rect x={inset} y={inset} width={Math.max(0, w - strokeWidth)} height={Math.max(0, h - strokeWidth)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      )}
    </svg>
  )
}
