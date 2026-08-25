import { normalizeRect } from './atlasEnclosure'
import type { AtlasGesturePoint } from './atlasNounRegistry'
import styles from './AtlasAreaMarquee.module.css'

// The area tool's own gesture.preview (goal 0215 S2): rendered
// generically by AtlasBoard's one overlay slot from the engine's own
// wrapper-local point accumulation -- the rect is the first and latest
// point normalized, the same corners the marquee always drew from.
export function AtlasAreaMarquee({ points }: { points: AtlasGesturePoint[]; now: number }) {
  if (points.length < 1) return null
  const rect = normalizeRect(points[0], points[points.length - 1])
  return (
    <div
      className={styles.marquee}
      data-testid="atlas-area-marquee"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    />
  )
}
