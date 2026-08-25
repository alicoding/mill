import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { enclosedIDs, normalizeRect } from './atlasEnclosure'
import type { Rect } from './atlasEnclosure'

export interface AreaDrawBox { id: string; x: number; y: number; width: number; height: number }

// A drag under this many screen pixels (either axis) is a stray click
// on the armed tool, not a draw -- disarms with no popover, matching
// the tray's own "one placement per arming" convention rather than
// creating an accidental empty area from a near-zero-size rect.
const MIN_DRAG_PX = 6

// The Area tool's own drag-to-draw gesture (goal 0081 slice A2, LOCKED
// design section 2 -- "draw empty" and "draw around"): mousedown
// starts a marquee, mousemove grows it, mouseup resolves which
// top-level cards/notes it encloses (atlasEnclosure.ts's own
// center-inside rule) and hands the result to onComplete, which owns
// opening the area popover. Disarms unconditionally on mouseup --
// "one draw per arming" applies whether or not the draw actually
// produced a popover. Esc mid-draw only clears the local rect; the
// global Escape listener (useAtlasCreation.ts's cancelAll) already
// disarms the tool itself.
//
// Wired as CAPTURE-phase pointer handlers (AtlasBoard.tsx's own
// onPointerDownCapture/etc, not bubble-phase onMouseDown) -- React
// Flow's own pane calls preventDefault() on its bubble-phase pointerdown
// to drive panning/node-drag, which silently suppresses the browser's
// OWN compatibility mousedown/mouseup events entirely. Capturing
// pointerdown on this wrapper (an ANCESTOR of the pane, so capture
// fires first) and stopping its propagation is what actually lets this
// hook own the gesture instead of racing React Flow for it.
//
// dragLocalRect is wrapper-relative pixels (AtlasBoard.tsx renders it
// directly as the marquee's CSS position) -- the wrapper's own
// bounding rect is read inside these event handlers only, never during
// render (React's own rule against reading a ref's value while
// rendering), so the raw screen points used for screenToFlowPosition
// at pointerup are tracked separately.
export function useAtlasAreaDraw({
  armed, screenToFlowPosition, cardBoxes, noteBoxes, disarm, onComplete, wrapperRef,
}: {
  armed: boolean
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  cardBoxes: AreaDrawBox[]
  noteBoxes: AreaDrawBox[]
  disarm: () => void
  onComplete: (screenPos: { x: number; y: number }, flowTopLeft: { x: number; y: number }, enclosedCardIDs: string[], enclosedNoteIDs: string[]) => void
  wrapperRef: RefObject<HTMLDivElement | null>
}) {
  const [dragLocalRect, setDragLocalRect] = useState<Rect | null>(null)
  const startScreenRef = useRef<{ x: number; y: number } | null>(null)
  const boxesRef = useRef({ cardBoxes, noteBoxes })
  useEffect(() => {
    boxesRef.current = { cardBoxes, noteBoxes }
  }, [cardBoxes, noteBoxes])

  const toLocal = (p: { x: number; y: number }) => {
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
    // starts its native (d3-drag) drag mid-draw.
    e.preventDefault()
    startScreenRef.current = { x: e.clientX, y: e.clientY }
    const local = toLocal(startScreenRef.current)
    setDragLocalRect({ x: local.x, y: local.y, width: 0, height: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toLocal reads wrapperRef.current at call time, deliberately not a dependency
  }, [armed])

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    if (!startScreenRef.current) return
    e.stopPropagation()
    setDragLocalRect(normalizeRect(toLocal(startScreenRef.current), toLocal({ x: e.clientX, y: e.clientY })))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same as onPointerDown above
  }, [])

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    const start = startScreenRef.current
    startScreenRef.current = null
    setDragLocalRect(null)
    if (!start) return
    e.stopPropagation()
    disarm()
    const end = { x: e.clientX, y: e.clientY }
    if (Math.abs(end.x - start.x) < MIN_DRAG_PX && Math.abs(end.y - start.y) < MIN_DRAG_PX) return
    const flowRect = normalizeRect(screenToFlowPosition(start), screenToFlowPosition(end))
    const enclosedCardIDs = enclosedIDs(flowRect, boxesRef.current.cardBoxes)
    const enclosedNoteIDs = enclosedIDs(flowRect, boxesRef.current.noteBoxes)
    onComplete(start, { x: flowRect.x, y: flowRect.y }, enclosedCardIDs, enclosedNoteIDs)
  }, [disarm, screenToFlowPosition, onComplete])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && startScreenRef.current) {
        startScreenRef.current = null
        setDragLocalRect(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return { dragLocalRect, onPointerDown, onPointerMove, onPointerUp }
}
