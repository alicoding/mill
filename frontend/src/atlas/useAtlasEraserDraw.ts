import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { pointHitIDs } from './atlasEnclosure'
import type { FrameBox } from './useAtlasDragFiling'

export interface EraserPoint { x: number; y: number }

// The eraser's own drag-to-erase gesture (goal 0169 slice 4): pointerdown
// starts a pass, pointermove hit-tests every new point against the
// board's TOP-LEVEL leaf boxes (containers excluded -- see atlasTools.ts's
// own eraserTool comment for why), accumulating touched ids into a
// running set; pointerup hands the WHOLE accumulated set to onComplete
// in one call and clears. Deliberately never deletes incrementally
// during the drag: onComplete feeds AtlasBoard's own onDeleteSelection
// prop, which produces exactly ONE undo toast per call (AtlasUndoToast.tsx
// -- "AtlasView renders exactly one of these at a time... cleared by...
// a later delete finalizing it") -- calling it once per touched element
// mid-drag would silently overwrite each earlier element's own undo
// window with the next one's. Sticky like the pencil tool (never
// disarms on its own): erasing is naturally a multi-pass action.
//
// Wired as CAPTURE-phase pointer handlers on an ANCESTOR of React
// Flow's pane, same reason useAtlasPencilDraw.ts's own header comment
// documents (RF's bubble-phase pointerdown suppresses the browser's
// own compatibility mouse events).
export function useAtlasEraserDraw({
  armed, screenToFlowPosition, cardBoxes, noteBoxes, onComplete, wrapperRef,
}: {
  armed: boolean
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  cardBoxes: FrameBox[]
  noteBoxes: { id: string; x: number; y: number; width: number; height: number }[]
  onComplete: (cardIDs: string[], noteIDs: string[]) => void
  wrapperRef: RefObject<HTMLDivElement | null>
}) {
  const [localPoints, setLocalPoints] = useState<EraserPoint[] | null>(null)
  const drawingRef = useRef(false)
  const hitCardsRef = useRef<Set<string>>(new Set())
  const hitNotesRef = useRef<Set<string>>(new Set())
  // Leaf-only scope: a frame's own box covers its entire child area, so
  // including it here would make erasing something INSIDE a frame risk
  // sweeping the frame away too. Refreshed via effect (not read during
  // render) matching useAtlasAreaDraw.ts's own boxesRef convention.
  const boxesRef = useRef({ cardBoxes: cardBoxes.filter((b) => !b.isFrame), noteBoxes })
  useEffect(() => {
    boxesRef.current = { cardBoxes: cardBoxes.filter((b) => !b.isFrame), noteBoxes }
  }, [cardBoxes, noteBoxes])

  const toLocal = (p: EraserPoint): EraserPoint => {
    const box = wrapperRef.current?.getBoundingClientRect()
    return box ? { x: p.x - box.left, y: p.y - box.top } : p
  }

  const testPoint = (client: EraserPoint) => {
    const flow = screenToFlowPosition(client)
    for (const id of pointHitIDs(flow, boxesRef.current.cardBoxes)) hitCardsRef.current.add(id)
    for (const id of pointHitIDs(flow, boxesRef.current.noteBoxes)) hitNotesRef.current.add(id)
  }

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (!armed || e.button !== 0) return
    e.stopPropagation()
    // Stopping propagation alone silences the pane's own pointerdown
    // handler -- including the preventDefault() THAT handler would have
    // called to suppress the browser's synthesized compatibility
    // mousedown. Without calling preventDefault() here too, that compat
    // mousedown still reaches whatever node sits under the cursor and
    // starts its native (d3-drag) drag mid-pass.
    e.preventDefault()
    drawingRef.current = true
    hitCardsRef.current = new Set()
    hitNotesRef.current = new Set()
    const point = { x: e.clientX, y: e.clientY }
    testPoint(point)
    setLocalPoints([toLocal(point)])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toLocal/testPoint read refs at call time, deliberately not dependencies
  }, [armed])

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    if (!drawingRef.current) return
    e.stopPropagation()
    const point = { x: e.clientX, y: e.clientY }
    testPoint(point)
    setLocalPoints((cur) => [...(cur ?? []), toLocal(point)])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same as onPointerDown above
  }, [])

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    if (!drawingRef.current) return
    e.stopPropagation()
    drawingRef.current = false
    setLocalPoints(null)
    const cardIDs = [...hitCardsRef.current]
    const noteIDs = [...hitNotesRef.current]
    hitCardsRef.current = new Set()
    hitNotesRef.current = new Set()
    if (cardIDs.length + noteIDs.length === 0) return
    onComplete(cardIDs, noteIDs)
  }, [onComplete])

  // Escape mid-pass cancels only the in-progress erase (no deletion),
  // matching useAtlasPencilDraw.ts/useAtlasAreaDraw.ts's own Escape
  // handling -- the global Escape listener (useAtlasCreation.ts's
  // cancelAll) disarms the tool itself separately.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drawingRef.current) {
        drawingRef.current = false
        hitCardsRef.current = new Set()
        hitNotesRef.current = new Set()
        setLocalPoints(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return { localPoints, onPointerDown, onPointerMove, onPointerUp }
}
