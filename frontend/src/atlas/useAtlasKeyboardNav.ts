import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { Node as RFNode, Viewport } from '@xyflow/react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { isEditableTarget } from '../shared/keybinding'
import { AtlasService } from '../shared/bindings'
import { isFocusInsideBoard, readSelectedNodeIDs } from './atlasFocusContainment'
import { nearestInDirection, readingOrder } from './atlasKeyboardNavGeometry'
import type { NavBox, NavDirection } from './atlasKeyboardNavGeometry'

const NUDGE_STEP = 1
const NUDGE_STEP_SHIFT = 10
const PAN_STEP = 60
const PAN_STEP_SHIFT = 240

const ARROW_KEYS: Record<string, NavDirection> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
}
const ARROW_DELTA: Record<NavDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 },
}

// Atlas keyboard navigation (goal 0104's key table -- one contract with
// 0102's gesture table): arrows nudge the selection or pan the empty
// camera, Tab/Shift+Tab walk top-level nodes in reading order,
// Option+Arrow jumps to the nearest node in that direction, Enter
// commits a single selected card. Escape's own ladder stays where it
// already lived (useAtlasCreation's cancelAll, useAtlasSelectionTray's
// clear-then-up) -- not duplicated here.
//
// A window-level listener, guarded two ways: isEditableTarget (typing
// in any field, including the placement popover's own title input,
// which renders inside this board's wrapper) and a focus-containment
// check (nothing keyboard-trapped in a portal-rendered Dialog/menu
// outside the wrapper) -- so a modal on top of the board keeps owning
// its own Tab/Enter/Arrows untouched.
export function useAtlasKeyboardNav<TNode extends RFNode>({
  cards, readOnly, wrapperRef,
  cardBoxes, noteBoxes,
  setNodes,
  isGroupCardFn, onOpenOverlay, onDrill,
  getViewport, setViewport,
}: {
  cards: Card[]
  readOnly: boolean
  wrapperRef: RefObject<HTMLDivElement | null>
  cardBoxes: NavBox[]
  noteBoxes: NavBox[]
  setNodes: (updater: (nodes: TNode[]) => TNode[]) => void
  isGroupCardFn: (card: Card) => boolean
  onOpenOverlay: (id: string) => void
  onDrill: (id: string) => void
  getViewport: () => Viewport
  setViewport: (vp: Viewport, opts?: { duration?: number }) => void
}) {
  const latest = useRef({ cards, readOnly, cardBoxes, noteBoxes, isGroupCardFn, onOpenOverlay, onDrill, getViewport, setViewport })
  useEffect(() => {
    latest.current = { cards, readOnly, cardBoxes, noteBoxes, isGroupCardFn, onOpenOverlay, onDrill, getViewport, setViewport }
  })

  // Nudge's own pending-persist accumulator: every held-key repeat
  // updates the RENDERED position immediately (setNodes), but the
  // Go-side SetPosition/SetNotePosition write is batched to keyup --
  // the drag-equivalent commit point, not a per-pixel round trip.
  const pendingNudgeRef = useRef<Map<string, { x: number; y: number; isNote: boolean }>>(new Map())

  useEffect(() => {
    const flushNudge = () => {
      for (const [id, pos] of pendingNudgeRef.current) {
        if (pos.isNote) void AtlasService.SetNotePosition(id, { X: pos.x, Y: pos.y }).catch(console.error)
        else void AtlasService.SetPosition(id, { X: pos.x, Y: pos.y }).catch(console.error)
      }
      pendingNudgeRef.current = new Map()
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key in ARROW_KEYS && pendingNudgeRef.current.size > 0) flushNudge()
    }

    // eslint-disable-next-line sonarjs/cognitive-complexity -- legacy complexity grandfathered at gate adoption; pay down when touched (goal 0109 burn-down)
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      if (!isFocusInsideBoard(wrapperRef)) return
      const { cards: c, readOnly: ro, cardBoxes: cb, noteBoxes: nb, isGroupCardFn: isGroup, onOpenOverlay: openOverlay, onDrill: drill, getViewport: getVp, setViewport: setVp } = latest.current
      // Read the DOM directly, not a selection-state mirror -- see
      // readSelectedNodeIDs' own header comment for the render-order
      // gap a fresh click's own next keypress can otherwise hit.
      const sel = readSelectedNodeIDs(wrapperRef)

      if (e.key === 'Tab') {
        e.preventDefault()
        const order = readingOrder([...cb, ...nb])
        if (order.length === 0) return
        const anchor = order.find((b) => sel.includes(b.id))
        const from = anchor ? order.indexOf(anchor) : (e.shiftKey ? 0 : -1)
        const next = order[(from + (e.shiftKey ? -1 : 1) + order.length) % order.length]
        setNodes((nds) => nds.map((node) => ({ ...node, selected: node.id === next.id })))
        return
      }

      if (e.key === 'Enter') {
        if (sel.length !== 1) return
        const card = c.find((cd) => cd.ID === sel[0])
        if (!card) return
        e.preventDefault()
        if (isGroup(card)) drill(card.ID)
        else openOverlay(card.ID)
        return
      }

      const direction = ARROW_KEYS[e.key]
      if (!direction) return
      if (e.metaKey || e.ctrlKey) return // atlas.up (⌘↑) owns Cmd/Ctrl+Arrow already
      e.preventDefault()

      if (e.altKey) {
        const boxes = [...cb, ...nb]
        const anchor = boxes.find((b) => sel.includes(b.id)) ?? readingOrder(boxes)[0]
        if (!anchor) return
        const target = nearestInDirection(anchor, boxes, direction)
        if (!target) return
        setNodes((nds) => nds.map((node) => ({ ...node, selected: node.id === target.id })))
        return
      }

      if (sel.length === 0) {
        const step = e.shiftKey ? PAN_STEP_SHIFT : PAN_STEP
        const { dx, dy } = ARROW_DELTA[direction]
        const vp = getVp()
        setVp({ x: vp.x - dx * step, y: vp.y - dy * step, zoom: vp.zoom })
        return
      }

      if (ro) return
      const step = e.shiftKey ? NUDGE_STEP_SHIFT : NUDGE_STEP
      const { dx, dy } = ARROW_DELTA[direction]
      const noteIDs = new Set(nb.map((b) => b.id))
      const movedIDs = new Set(sel)
      setNodes((nds) => nds.map((node) => {
        if (!movedIDs.has(node.id) || node.parentId) return node
        const position = { x: node.position.x + dx * step, y: node.position.y + dy * step }
        pendingNudgeRef.current.set(node.id, { x: position.x, y: position.y, isNote: noteIDs.has(node.id) })
        return { ...node, position }
      }))
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [setNodes, wrapperRef])
}
