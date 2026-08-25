import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { arrowGeometry } from './atlasShapeSvg'
import { useAtlasShapeRotateLive } from './atlasShapeRotateLiveStore'

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
export function AtlasShapeContent({ object }: { object: BoardObject }) {
  const payload = object.Payload ?? {}
  const shapeType = payload.shapeType
  const stroke = payload.stroke || '#1f6feb'
  const strokeWidth = Number(payload.strokeWidth) || 2
  const fill = payload.fill || 'none'
  // Read unconditionally (react-hooks/rules-of-hooks) even though only
  // the rectangle/ellipse branch below ever uses it -- arrow returns
  // early and simply never applies it.
  const liveRotation = useAtlasShapeRotateLive(object.ID)

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
  // Rotation (goal 0214, rectangle/ellipse only -- arrow's own
  // geometry IS its dx/dy payload, so an angle would be a second,
  // conflicting representation). A live drag override (the rotate
  // handle's own ephemeral store, read above) always wins over the
  // persisted value so the shape turns with the pointer before
  // anything is saved; rotating the whole <svg> (rather than its inner
  // shape) keeps the transform origin unambiguous -- viewBox and this
  // element's own CSS box coincide exactly since preserveAspectRatio
  // ="none" never letterboxes.
  const rotation = liveRotation ?? (Number(payload.rotation) || 0)

  return (
    <svg
      data-testid="atlas-shape-content"
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ display: 'block', transform: rotation ? `rotate(${rotation}deg)` : undefined, transformOrigin: '50% 50%' }}
    >
      {shapeType === 'ellipse' ? (
        <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - inset)} ry={Math.max(0, h / 2 - inset)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      ) : (
        <rect x={inset} y={inset} width={Math.max(0, w - strokeWidth)} height={Math.max(0, h - strokeWidth)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      )}
    </svg>
  )
}
