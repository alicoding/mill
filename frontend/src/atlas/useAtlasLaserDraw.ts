import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

export interface LaserPoint { x: number; y: number; t: number }

// Laser pointer fade duration (goal 0169 slice 4): a point stays
// visible for this many ms after being drawn, then ages out on its
// own -- long enough to trace a gesture while talking, short enough to
// never read as a lingering mark. Exported so the trail component's
// own per-point opacity math (AtlasLaserTrail.tsx) shares the exact
// same window rather than a second hand-copied constant.
export const LASER_FADE_MS = 700

// The laser tool's own ephemeral-drag gesture (goal 0169 slice 4):
// EVERY point lives in LOCAL (wrapper-relative) coordinates only --
// unlike the pencil/eraser hooks, this one never calls
// screenToFlowPosition or reads a board box, because a laser trail
// never interacts with board content at all. Points are never cleared
// as a batch; a single continuous requestAnimationFrame loop prunes
// whatever has aged past LASER_FADE_MS on every frame, which is what
// makes the trail fade on its own with NO user action and NO commit --
// there is structurally no AtlasService call anywhere in this file, so
// there is nothing for a reload to read back.
//
// Wired as CAPTURE-phase pointer handlers on an ANCESTOR of React
// Flow's pane, same reason useAtlasPencilDraw.ts's own header comment
// documents.
export function useAtlasLaserDraw({ armed, wrapperRef }: {
  armed: boolean
  wrapperRef: RefObject<HTMLDivElement | null>
}) {
  const [points, setPoints] = useState<LaserPoint[]>([])
  // The render's own "current time," fed to the trail component as a
  // prop rather than left for it to read performance.now() itself
  // during render (impure -- React's own render-purity rule) -- this
  // hook is the one place that legitimately reads the clock, inside an
  // async rAF callback that never runs during a render pass.
  const [now, setNow] = useState(0)
  const pointsRef = useRef<LaserPoint[]>([])
  const drawingRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  // Holds the latest tick closure so tick's own recursive scheduling
  // below can reach it as tickRef.current() -- a ref read at CALL time,
  // not the bare identifier -- avoiding a "used before it's declared"
  // self-reference, while keeping tick itself inside useCallback (the
  // same recognized non-render-execution boundary onPointerDown/
  // onPointerMove already rely on for their own performance.now() calls).
  const tickRef = useRef<() => void>(() => {})

  const toLocal = (p: { x: number; y: number }): { x: number; y: number } => {
    const box = wrapperRef.current?.getBoundingClientRect()
    return box ? { x: p.x - box.left, y: p.y - box.top } : p
  }

  // One rAF loop, started lazily and self-terminating once nothing is
  // left to prune -- never a setInterval ticking in the background
  // after the trail has fully faded.
  const tick = useCallback(() => {
    const t = performance.now()
    pointsRef.current = pointsRef.current.filter((p) => t - p.t < LASER_FADE_MS)
    setPoints([...pointsRef.current])
    setNow(t)
    rafRef.current = (pointsRef.current.length > 0 || drawingRef.current) ? requestAnimationFrame(() => tickRef.current()) : null
  }, [])
  // A ref write belongs in an effect, never directly in the render
  // body (React's own rule -- writing during render can desync from
  // what actually committed) -- tick's identity is stable (empty deps
  // above), so this effect only ever really runs once.
  useEffect(() => {
    tickRef.current = tick
  }, [tick])

  const ensureLoop = () => {
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick)
  }

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (!armed || e.button !== 0) return
    e.stopPropagation()
    // Stopping propagation alone silences the pane's own pointerdown
    // handler -- including the preventDefault() THAT handler would have
    // called to suppress the browser's synthesized compatibility
    // mousedown. Without calling preventDefault() here too, that compat
    // mousedown still reaches whatever node sits under the cursor and
    // starts its native (d3-drag) drag mid-trail.
    e.preventDefault()
    drawingRef.current = true
    pointsRef.current = [...pointsRef.current, { ...toLocal({ x: e.clientX, y: e.clientY }), t: performance.now() }]
    setPoints([...pointsRef.current])
    ensureLoop()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toLocal reads wrapperRef.current at call time, deliberately not a dependency
  }, [armed])

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    if (!drawingRef.current) return
    e.stopPropagation()
    pointsRef.current = [...pointsRef.current, { ...toLocal({ x: e.clientX, y: e.clientY }), t: performance.now() }]
    // The tick loop (already running from pointerdown) picks up this
    // new point on its next frame -- no setPoints call here, so a fast
    // pointermove burst costs one state update per animation frame
    // rather than one per event.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same as onPointerDown above
  }, [])

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    if (!drawingRef.current) return
    e.stopPropagation()
    drawingRef.current = false
    // Deliberately no setPoints/clear here -- the existing points age
    // out through the same tick loop, which is the fade itself.
  }, [])

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
  }, [])

  return { points, now, onPointerDown, onPointerMove, onPointerUp }
}
