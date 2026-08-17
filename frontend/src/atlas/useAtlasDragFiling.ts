import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { freeChildPosition } from './atlasContainmentPlacement'

export interface FrameBox { id: string; x: number; y: number; width: number; height: number; isFrame: boolean }
interface DraggedNode { id: string; type?: string; parentId?: string; position: { x: number; y: number }; width?: number | null; height?: number | null }

// Drag filing into/out of area frames (goal 0081 slice A2, LOCKED
// design section 4): React Flow gives the parent/child DATA model but
// no drag-to-file INTERACTION -- the drop-target intersection test is
// hand-built on the drag-stop event (core-domain work per
// architecture.md's reuse boundary), composing with the existing
// overlap-resolution pass rather than fighting it.
//
// Filing INTO a frame: the dragged node's center lands inside a
// top-level frame's own box (highlighted live via onNodeDrag while the
// drag is in progress). Un-filing OUT: dropped past the visible board
// wrapper's own edge while standing inside a container -- a frame
// renders no boundary of its own once you're drilled inside it, so
// "the level you're currently in" is represented by the wrapper's own
// visible extent, not a rectangle on the canvas.
export function useAtlasDragFiling({ allCards, parentID, topLevelBoxes, wrapperRef }: {
  allCards: Card[]
  parentID: string
  topLevelBoxes: FrameBox[]
  wrapperRef: RefObject<HTMLDivElement | null>
}) {
  const [hoveredFrameID, setHoveredFrameID] = useState<string | null>(null)
  // Latest-refs, synced via effect rather than during render
  // (useBoardFocus.ts's own convention) -- every callback below is
  // useCallback-wrapped with an empty/stable dependency list so its
  // own identity never churns the RF prop it's passed as.
  const boxesRef = useRef(topLevelBoxes)
  const allCardsRef = useRef(allCards)
  const parentIDRef = useRef(parentID)
  useEffect(() => {
    boxesRef.current = topLevelBoxes
    allCardsRef.current = allCards
    parentIDRef.current = parentID
  }, [topLevelBoxes, allCards, parentID])

  const frameUnder = useCallback((node: DraggedNode) => {
    const cx = node.position.x + (node.width ?? 0) / 2
    const cy = node.position.y + (node.height ?? 0) / 2
    return boxesRef.current.find((b) => b.isFrame && b.id !== node.id && cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height) ?? null
  }, [])

  const onNodeDrag = useCallback((_e: unknown, node: DraggedNode) => {
    if (node.parentId) return
    setHoveredFrameID(frameUnder(node)?.id ?? null)
  }, [frameUnder])

  const reparentNote = useCallback((id: string, newParentID: string) => {
    const position = freeChildPosition(allCardsRef.current, newParentID)
    void AtlasService.MoveNote(id, newParentID)
      .then(() => AtlasService.SetNotePosition(id, position))
      .then(() => refreshAtlas())
      .catch(console.error)
  }, [])

  const reparentCard = useCallback((id: string, newParentID: string) => {
    const position = freeChildPosition(allCardsRef.current, newParentID)
    void AtlasService.MoveCard(id, newParentID)
      .then(() => AtlasService.SetPosition(id, position))
      .then(() => refreshAtlas())
      .catch(console.error)
  }, [])

  // React Flow's own onNodeDragStop hands back the raw browser event
  // (MouseEvent OR TouchEvent) -- a touch event carries its point in
  // .touches[0] rather than top-level clientX/clientY.
  const pointOf = (e: MouseEvent | TouchEvent): { x: number; y: number } | null => {
    if ('clientX' in e) return { x: e.clientX, y: e.clientY }
    const touch = e.touches[0] ?? e.changedTouches[0]
    return touch ? { x: touch.clientX, y: touch.clientY } : null
  }

  const onNodeDragStop = useCallback((e: MouseEvent | TouchEvent, node: DraggedNode) => {
    setHoveredFrameID(null)
    if (node.parentId) return
    const isNote = node.type === 'atlas-sticky'
    const reparent = isNote ? reparentNote : reparentCard

    const target = frameUnder(node)
    if (target) {
      reparent(node.id, target.id)
      return
    }

    const point = pointOf(e)
    const wrapperBox = wrapperRef.current?.getBoundingClientRect()
    const droppedOutsideBoard = !!point && !!wrapperBox
      && (point.x < wrapperBox.left || point.x > wrapperBox.right || point.y < wrapperBox.top || point.y > wrapperBox.bottom)
    if (droppedOutsideBoard && parentIDRef.current !== '') {
      const upToID = allCardsRef.current.find((c) => c.ID === parentIDRef.current)?.ParentID ?? ''
      reparent(node.id, upToID)
      return
    }

    if (isNote) void AtlasService.SetNotePosition(node.id, { X: node.position.x, Y: node.position.y }).catch(console.error)
    else void AtlasService.SetPosition(node.id, { X: node.position.x, Y: node.position.y }).catch(console.error)
  }, [frameUnder, reparentNote, reparentCard, wrapperRef])

  return { hoveredFrameID, onNodeDrag, onNodeDragStop }
}
