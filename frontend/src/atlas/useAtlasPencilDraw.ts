import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { PencilPoint } from './atlasPencilSvg'

// A stroke under this many screen pixels of total extent (either axis)
// is a stray click on the armed tool, not a draw -- same MIN_DRAG_PX
// convention useAtlasAreaDraw.ts already uses for the same reason
// (never leave an accidental point-sized sketch behind).
const MIN_DRAG_PX = 6

// The pencil tool's own drag-to-draw gesture (goal 0169 slice 3):
// pointerdown starts a stroke, pointermove appends to it (localPoints,
// wrapper-relative, feeds AtlasBoard's own live preview overlay),
// pointerup hands the completed CLIENT-space point list to onComplete
// and commits it. UNLIKE useAtlasAreaDraw.ts, this hook never disarms
// on its own -- pencil is a sticky tool (a real drawing app's own
// convention: it stays selected across multiple strokes until the
// user explicitly switches tools), so completing one stroke leaves the
// tool armed for the next.
//
// Wired as CAPTURE-phase pointer handlers for the same reason
// useAtlasAreaDraw.ts's own header comment documents: React Flow's
// pane calls preventDefault() on its own bubble-phase pointerdown to
// drive panning/node-drag, which silently suppresses the browser's own
// compatibility mouse events. Capturing pointerdown on an ANCESTOR of
// the pane and stopping propagation is what lets this hook own the
// gesture instead of racing React Flow for it.
export function useAtlasPencilDraw({
  armed, onComplete, wrapperRef,
}: {
  armed: boolean
  onComplete: (points: PencilPoint[]) => void
  wrapperRef: RefObject<HTMLDivElement | null>
}) {
  const [localPoints, setLocalPoints] = useState<PencilPoint[] | null>(null)
  const clientPointsRef = useRef<PencilPoint[]>([])
  const drawingRef = useRef(false)

  const toLocal = (p: PencilPoint): PencilPoint => {
    const box = wrapperRef.current?.getBoundingClientRect()
    return box ? { x: p.x - box.left, y: p.y - box.top } : p
  }

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (!armed || e.button !== 0) return
    e.stopPropagation()
    // Stopping propagation alone silences the pane's own pointerdown
    // handler -- including the preventDefault() THAT handler would have
    // called to suppress the browser's synthesized compatibility
    // mousedown. Without calling preventDefault() here too, that compat
    // mousedown still reaches whatever node sits under the cursor and
    // starts its native (d3-drag) drag mid-stroke.
    e.preventDefault()
    drawingRef.current = true
    const point = { x: e.clientX, y: e.clientY }
    clientPointsRef.current = [point]
    setLocalPoints([toLocal(point)])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toLocal reads wrapperRef.current at call time, deliberately not a dependency
  }, [armed])

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    if (!drawingRef.current) return
    e.stopPropagation()
    const point = { x: e.clientX, y: e.clientY }
    clientPointsRef.current.push(point)
    setLocalPoints((cur) => [...(cur ?? []), toLocal(point)])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same as onPointerDown above
  }, [])

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    if (!drawingRef.current) return
    e.stopPropagation()
    drawingRef.current = false
    const points = clientPointsRef.current
    clientPointsRef.current = []
    setLocalPoints(null)
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const extentX = xs.length ? Math.max(...xs) - Math.min(...xs) : 0
    const extentY = ys.length ? Math.max(...ys) - Math.min(...ys) : 0
    if (points.length < 2 || (extentX < MIN_DRAG_PX && extentY < MIN_DRAG_PX)) return
    onComplete(points)
  }, [onComplete])

  // Escape mid-stroke cancels only the IN-PROGRESS stroke, matching
  // useAtlasAreaDraw.ts's own Escape handling -- the global Escape
  // listener (useAtlasCreation.ts's cancelAll) disarms the tool itself
  // separately.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drawingRef.current) {
        drawingRef.current = false
        clientPointsRef.current = []
        setLocalPoints(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return { localPoints, onPointerDown, onPointerMove, onPointerUp }
}
