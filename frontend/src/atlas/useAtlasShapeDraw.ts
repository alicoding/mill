import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

export interface ShapePoint { x: number; y: number }

// A drag under this many screen pixels (either axis) is a stray click
// on the armed tool, not a draw -- same MIN_DRAG_PX convention
// useAtlasAreaDraw.ts/useAtlasPencilDraw.ts already use for the same
// reason (never leave an accidental point-sized shape behind).
const MIN_DRAG_PX = 6

// The shape tool's own drag-to-draw gesture (goal 0169 slice 5):
// pointerdown marks the start corner, pointermove tracks the live end
// point (localStart/localCurrent feed AtlasShapeLivePreview's own
// rect/ellipse/arrow rendering), pointerup hands the CLIENT-space
// start/end pair to onComplete. Like Pencil, this hook never disarms on
// its own -- shape is a sticky tool (drawing several in one session
// stays uninterrupted, the same "don't force a commit ceremony"
// correction goal 0179 made for ink).
//
// Wired as CAPTURE-phase pointer handlers for the same reason
// useAtlasAreaDraw.ts's own header comment documents: React Flow's pane
// calls preventDefault() on its own bubble-phase pointerdown to drive
// panning/node-drag, which silently suppresses the browser's own
// compatibility mouse events. Capturing pointerdown on an ANCESTOR of
// the pane and stopping propagation is what lets this hook own the
// gesture instead of racing React Flow for it.
export function useAtlasShapeDraw({
  armed, onComplete, wrapperRef,
}: {
  armed: boolean
  onComplete: (start: ShapePoint, end: ShapePoint) => void
  wrapperRef: RefObject<HTMLDivElement | null>
}) {
  const [localStart, setLocalStart] = useState<ShapePoint | null>(null)
  const [localCurrent, setLocalCurrent] = useState<ShapePoint | null>(null)
  const startRef = useRef<ShapePoint | null>(null)

  const toLocal = (p: ShapePoint): ShapePoint => {
    const box = wrapperRef.current?.getBoundingClientRect()
    return box ? { x: p.x - box.left, y: p.y - box.top } : p
  }

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (!armed || e.button !== 0) return
    e.stopPropagation()
    const point = { x: e.clientX, y: e.clientY }
    startRef.current = point
    setLocalStart(toLocal(point))
    setLocalCurrent(toLocal(point))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toLocal reads wrapperRef.current at call time, deliberately not a dependency
  }, [armed])

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    if (!startRef.current) return
    e.stopPropagation()
    setLocalCurrent(toLocal({ x: e.clientX, y: e.clientY }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same as onPointerDown above
  }, [])

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    const start = startRef.current
    startRef.current = null
    setLocalStart(null)
    setLocalCurrent(null)
    if (!start) return
    e.stopPropagation()
    const end = { x: e.clientX, y: e.clientY }
    if (Math.abs(end.x - start.x) < MIN_DRAG_PX && Math.abs(end.y - start.y) < MIN_DRAG_PX) return
    onComplete(start, end)
  }, [onComplete])

  // Escape mid-draw cancels only the IN-PROGRESS shape, matching
  // useAtlasAreaDraw.ts/useAtlasPencilDraw.ts's own Escape handling --
  // the global Escape listener (useAtlasCreation.ts's cancelAll) disarms
  // the tool itself separately.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && startRef.current) {
        startRef.current = null
        setLocalStart(null)
        setLocalCurrent(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return { localStart, localCurrent, onPointerDown, onPointerMove, onPointerUp }
}
