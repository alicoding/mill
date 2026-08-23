import { livePreviewPathData } from './atlasPencilSvg'
import type { PencilPoint } from './atlasPencilSvg'

const ERASER_TRAIL_SIZE = 18

// The eraser's own live trail while a pass is mid-drag (goal 0169
// slice 4): the SAME wrapper-spanning, pointer-events-disabled overlay
// pattern AtlasPencilLivePreview.tsx already established, reused
// rather than a second ephemeral-overlay mechanism -- only the stroke
// shape's colour/width differ, both fixed (an eraser has no colour/
// size options bar, unlike the pencil).
export function AtlasEraserLiveTrail({ points }: { points: PencilPoint[] }) {
  const d = livePreviewPathData(points, ERASER_TRAIL_SIZE)
  if (!d) return null
  return (
    <svg data-testid="atlas-eraser-trail" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <path d={d} fill="#da3633" fillOpacity={0.35} />
    </svg>
  )
}
