import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { computeNestedCardBoxes } from './atlasBoardBoxes'
import type { FrameBox } from './useAtlasDragFiling'

interface SlotDragState {
  fromCardID: string
  linkKindID: string
  start: { x: number; y: number }
  current: { x: number; y: number }
}

export interface AtlasSlotDragLine { x1: number; y1: number; x2: number; y2: number }

// How long the drop-refusal explanation stays on screen before
// clearing itself (mirrors composition's own connection-refusal-hint
// timing, ADR-0042 slice 2).
const HINT_DURATION_MS = 5000

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
// marquee.
//
// Release resolution (LOCKED design §3, decision D1=B, refined goal
// 0124 slice 2): a release is hit-tested against nested cards FIRST
// (the specific card a frame is previewing), then top-level cards/
// frames, then notes -- most-specific candidate wins, so a release
// visually on a nested card's own tile never falls through to its
// enclosing frame. The dragged-from card itself is a no-op (it never
// renders as a candidate in the first place -- atlasBuildBoardNodes.ts's
// own highlight excludes it). A note is a REAL illegal target (a Note
// isn't a Card and can never hold a Link) -- releasing there surfaces
// the refusal hint. Empty canvas opens the guided-create popover
// through onGuidedCreate. Esc cancels mid-drag.
export function useAtlasSlotDrag({
  topLevelBoxes, noteBoxes, allCards, kinds, screenToFlowPosition, onLink, onGuidedCreate,
}: {
  topLevelBoxes: FrameBox[]
  noteBoxes: { id: string; x: number; y: number; width: number; height: number }[]
  allCards: Card[]
  kinds: Kind[]
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  onLink: (fromCardID: string, toCardID: string, linkKindID: string) => void
  onGuidedCreate: (fromCardID: string, linkKindID: string, screenPos: { x: number; y: number }, flowPos: { x: number; y: number }) => void
}) {
  const { t } = useTranslation('atlas')
  const [drag, setDrag] = useState<SlotDragState | null>(null)
  const [refusalHint, setRefusalHint] = useState<string | null>(null)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The specific card under a frame's own preview tile -- see
  // computeNestedCardBoxes's own header comment for why a release
  // needs this ahead of topLevelBoxes.
  const nestedBoxes = useMemo(() => computeNestedCardBoxes(topLevelBoxes, allCards), [topLevelBoxes, allCards])

  // Latest-refs (useAtlasDragFiling's own convention): every box/
  // callback below is read at pointerup time, never captured stale
  // inside the drag-start closure.
  const topLevelBoxesRef = useRef(topLevelBoxes)
  const nestedBoxesRef = useRef(nestedBoxes)
  const noteBoxesRef = useRef(noteBoxes)
  const allCardsRef = useRef(allCards)
  const kindsRef = useRef(kinds)
  const screenToFlowRef = useRef(screenToFlowPosition)
  const onLinkRef = useRef(onLink)
  const onGuidedCreateRef = useRef(onGuidedCreate)
  useEffect(() => {
    topLevelBoxesRef.current = topLevelBoxes
    nestedBoxesRef.current = nestedBoxes
    noteBoxesRef.current = noteBoxes
    allCardsRef.current = allCards
    kindsRef.current = kinds
    screenToFlowRef.current = screenToFlowPosition
    onLinkRef.current = onLink
    onGuidedCreateRef.current = onGuidedCreate
  }, [topLevelBoxes, nestedBoxes, noteBoxes, allCards, kinds, screenToFlowPosition, onLink, onGuidedCreate])

  useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
  }, [])

  const kindLabelOf = useCallback((cardID: string): string => {
    const card = allCardsRef.current.find((c) => c.ID === cardID)
    const kind = card ? kindsRef.current.find((k) => k.ID === card.KindID) : undefined
    return kind?.Label ?? ''
  }, [])

  const showRefusalHint = useCallback((fromCardID: string) => {
    setRefusalHint(t('board.linkRefusalHint', { sourceKindLabel: kindLabelOf(fromCardID), targetKindLabel: t('creationTray.noteLabel') }))
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    clearTimerRef.current = setTimeout(() => {
      setRefusalHint(null)
      clearTimerRef.current = null
    }, HINT_DURATION_MS)
  }, [t, kindLabelOf])

  const startDrag = useCallback((fromCardID: string, linkKindID: string, e: ReactPointerEvent) => {
    const pos = { x: e.clientX, y: e.clientY }
    setDrag({ fromCardID, linkKindID, start: pos, current: pos })
    setRefusalHint(null)
    if (clearTimerRef.current) { clearTimeout(clearTimerRef.current); clearTimerRef.current = null }
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

        const nested = hitTest(flowPos, nestedBoxesRef.current)
        if (nested) {
          if (nested.id !== d.fromCardID) onLinkRef.current(d.fromCardID, nested.id, d.linkKindID)
          return null
        }
        const target = hitTest(flowPos, topLevelBoxesRef.current)
        if (target) {
          if (target.id !== d.fromCardID) onLinkRef.current(d.fromCardID, target.id, d.linkKindID)
          return null
        }
        if (hitTest(flowPos, noteBoxesRef.current)) {
          showRefusalHint(d.fromCardID) // a note isn't a Card -- it can never hold a link
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
  }, [drag !== null, showRefusalHint])

  const dragLine: AtlasSlotDragLine | null = drag ? { x1: drag.start.x, y1: drag.start.y, x2: drag.current.x, y2: drag.current.y } : null

  return { dragSourceID: drag?.fromCardID ?? null, dragActive: drag !== null, dragLine, startDrag, refusalHint }
}
