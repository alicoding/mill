import { livePreviewPathData } from './atlasPencilSvg'
import type { PencilPoint } from './atlasPencilSvg'

// The pencil tool's own live preview while a stroke is mid-drag
// (useAtlasPencilDraw.ts's localPoints): a wrapper-spanning SVG
// overlay, pointer-events disabled so it never steals the very drag
// it's rendering. Renders nothing for a not-yet-a-stroke point count,
// same MIN_DRAG_PX-adjacent honesty the hook's own commit guard uses.
export function AtlasPencilLivePreview({ points, color, size }: { points: PencilPoint[]; color: string; size: number }) {
  const d = livePreviewPathData(points, size)
  if (!d) return null
  return (
    <svg data-testid="atlas-pencil-preview" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <path d={d} fill={color} />
    </svg>
  )
}
