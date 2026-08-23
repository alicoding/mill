import { LASER_FADE_MS } from './useAtlasLaserDraw'
import type { LaserPoint } from './useAtlasLaserDraw'

// The laser's own live trail (goal 0169 slice 4): the SAME wrapper-
// spanning, pointer-events-disabled overlay pattern
// AtlasPencilLivePreview.tsx established, rendering a per-point dot
// whose own opacity/radius fade linearly with age -- not a single
// filled path (AtlasEraserLiveTrail.tsx's own choice), because a laser
// trail needs each point fading INDEPENDENTLY (older = fainter), which
// a single uniform-opacity path shape can't express. `now` is a PROP
// (the hook's own tick loop reads the real clock, in an async rAF
// callback that never runs during render) rather than read here via
// performance.now() -- calling the clock directly inside a component's
// render body is impure and produces unstable output across identical
// re-renders.
export function AtlasLaserTrail({ points, now }: { points: LaserPoint[]; now: number }) {
  if (points.length === 0) return null
  return (
    <svg data-testid="atlas-laser-trail" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {points.map((p, i) => {
        const age = Math.min(1, Math.max(0, (now - p.t) / LASER_FADE_MS))
        const opacity = 1 - age
        const radius = 6 - age * 4
        return <circle key={i} cx={p.x} cy={p.y} r={radius} fill="#ff3b30" fillOpacity={opacity} />
      })}
    </svg>
  )
}
