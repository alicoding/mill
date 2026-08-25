import { livePreviewPathData } from './atlasPencilSvg'
import { useAtlasPencilStyle } from './atlasStyleValueStore'
import type { AtlasGesturePoint } from './atlasNounRegistry'

// The pencil tool's own gesture.preview (goal 0215 S2, absorbing goal
// 0169 slice 3's original component): a wrapper-spanning SVG overlay,
// pointer-events disabled so it never steals the very drag it's
// rendering. Reads the live colour/size straight off the style store
// itself (the same session-only cache the tool's own onEnd commits
// from) rather than taking them as props -- the engine's own preview
// slot only ever passes the generic {points, now} shape. Renders
// nothing for a not-yet-a-stroke point count, same MIN_DRAG_PX-adjacent
// honesty the tool's own onEnd commit guard uses.
export function AtlasPencilLivePreview({ points }: { points: AtlasGesturePoint[]; now: number }) {
  const { color, size } = useAtlasPencilStyle()
  const d = livePreviewPathData(points, size)
  if (!d) return null
  return (
    <svg data-testid="atlas-pencil-preview" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <path d={d} fill={color} />
    </svg>
  )
}
