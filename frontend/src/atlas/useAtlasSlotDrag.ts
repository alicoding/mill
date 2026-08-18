import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { FrameBox } from './useAtlasDragFiling'

interface SlotDragState {
  fromCardID: string
  linkKindID: string
  start: { x: number; y: number }
  current: { x: number; y: number }
}

export interface AtlasSlotDragLine { x1: number; y1: number; x2: number; y2: number }

function hitTest(p: { x: number; y: number }, boxes: { id: string; x: number; y: number; width: number; height: number }[]) {
  return boxes.find((b) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) ?? null
}

// Slot-drag = instant typed link (goal 0081 slice A4, LOCKED design
// §3): a custom pointer-driven drag, NOT React Flow's own connection-
// line mechanics -- the board sets nodesConnectable={false} everywhere
// (AtlasNoteCardNode's own Handle pair exists only so an EXISTING link
// can attach, never to start a new RF connection), so fighting that
// board-wide setting per-anchor would mean re-enabling a mechanism
// deliberately turned off elsewhere. Same custom-pointer-drag shape
// useAtlasAreaDraw.ts already established for the Area tool's own
// marquee, hit-testing against the SAME topLevelBoxes/noteBoxes
// AtlasBoard already threads to useAtlasDragFiling -- a target is
// therefore always a TOP-LEVEL card or note on the current board, the
// same scope drag-filing already operates in.
//
// Release resolution (LOCKED design §3, decision D1=B): a note or the
// dragged-from card itself is a no-op; another top-level card creates
// the link immediately; empty canvas opens the guided-create popover
// through onGuidedCreate. Esc cancels mid-drag.
export function useAtlasSlotDrag({
  topLevelBoxes, noteBoxes, screenToFlowPosition, onLink, onGuidedCreate,
}: {
  topLevelBoxes: FrameBox[]
  noteBoxes: { id: string; x: number; y: number; width: number; height: number }[]
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  onLink: (fromCardID: string, toCardID: string, linkKindID: string) => void
  onGuidedCreate: (fromCardID: string, linkKindID: string, screenPos: { x: number; y: number }, flowPos: { x: number; y: number }) => void
}) {
  const [drag, setDrag] = useState<SlotDragState | null>(null)

  // Latest-refs (useAtlasDragFiling's own convention): every box/
  // callback below is read at pointerup time, never captured stale
  // inside the drag-start closure.
  const topLevelBoxesRef = useRef(topLevelBoxes)
  const noteBoxesRef = useRef(noteBoxes)
  const screenToFlowRef = useRef(screenToFlowPosition)
  const onLinkRef = useRef(onLink)
  const onGuidedCreateRef = useRef(onGuidedCreate)
  useEffect(() => {
    topLevelBoxesRef.current = topLevelBoxes
    noteBoxesRef.current = noteBoxes
    screenToFlowRef.current = screenToFlowPosition
    onLinkRef.current = onLink
    onGuidedCreateRef.current = onGuidedCreate
  }, [topLevelBoxes, noteBoxes, screenToFlowPosition, onLink, onGuidedCreate])

  const startDrag = useCallback((fromCardID: string, linkKindID: string, e: ReactPointerEvent) => {
    const pos = { x: e.clientX, y: e.clientY }
    setDrag({ fromCardID, linkKindID, start: pos, current: pos })
  }, [])

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const pos = { x: e.clientX, y: e.clientY }
      setDrag((d) => (d ? { ...d, current: pos } : d))
    }
    const onUp = (e: PointerEvent) => {
      const release = { x: e.clientX, y: e.clientY }
      setDrag((d) => {
        if (!d) return null
        // A browser synthesizes a "click" on the nearest common ancestor
        // of the mousedown and mouseup targets -- releasing back onto
        // the SAME card (the handle's own parent) makes that ancestor
        // the card itself, so its own onClick would otherwise see a
        // spurious click right after this drag resolves (goal 0102's
        // click model: on an already-selected card, that would wrongly
        // COMMIT). A one-shot capture-phase listener swallows exactly
        // that one following click, for every release target, not just
        // the same-card case -- harmless when no click was going to
        // follow anyway.
        window.addEventListener('click', (ce) => ce.stopPropagation(), { capture: true, once: true })
        const flowPos = screenToFlowRef.current(release)
        if (hitTest(flowPos, noteBoxesRef.current)) return null // a note is a no-op release target
        const target = hitTest(flowPos, topLevelBoxesRef.current)
        if (target) {
          if (target.id !== d.fromCardID) onLinkRef.current(d.fromCardID, target.id, d.linkKindID)
          return null
        }
        onGuidedCreateRef.current(d.fromCardID, d.linkKindID, release, flowPos)
        return null
      })
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on drag-active alone; every value read inside is a ref, synced above
  }, [drag !== null])

  const dragLine: AtlasSlotDragLine | null = drag ? { x1: drag.start.x, y1: drag.start.y, x2: drag.current.x, y2: drag.current.y } : null

  return { dragSourceID: drag?.fromCardID ?? null, dragActive: drag !== null, dragLine, startDrag }
}
