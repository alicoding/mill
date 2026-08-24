import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { freeChildPosition } from './atlasContainmentPlacement'

export interface FrameBox { id: string; x: number; y: number; width: number; height: number; isFrame: boolean }
interface DraggedNode { id: string; type?: string; parentId?: string; position: { x: number; y: number }; width?: number | null; height?: number | null }

// entityKindOf resolves a dragged node's own family purely off its RF
// node type -- 'atlas-sticky' is a note, 'atlas-object' is a board-
// local object (goal 0179/0180), everything else is a card. One
// dispatch point so MoveX/SetXPosition selection never needs a second
// isNote-shaped boolean added per new family.
function entityKindOf(node: DraggedNode): 'note' | 'object' | 'card' {
  if (node.type === 'atlas-sticky') return 'note'
  if (node.type === 'atlas-object') return 'object'
  return 'card'
}

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

  // absNode lifts a frame child's parent-relative position to board
  // coordinates so the same intersection tests apply (goal 0141).
  const absNode = useCallback((node: DraggedNode): DraggedNode => {
    if (!node.parentId) return node
    const parentBox = boxesRef.current.find((b) => b.id === node.parentId)
    if (!parentBox) return node
    return { ...node, position: { x: parentBox.x + node.position.x, y: parentBox.y + node.position.y } }
  }, [])

  const onNodeDrag = useCallback((_e: unknown, node: DraggedNode) => {
    const abs = absNode(node)
    const target = frameUnder(abs)
    setHoveredFrameID(target && target.id !== node.parentId ? target.id : null)
  }, [frameUnder, absNode])

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

  // Board objects (goal 0179/0180) share the exact same drag-filing
  // shape as notes -- their own reparent + set-position pair, wired the
  // same way in the entityKindOf dispatch below.
  const reparentObject = useCallback((id: string, newParentID: string) => {
    const position = freeChildPosition(allCardsRef.current, newParentID)
    void AtlasService.MoveBoardObject(id, newParentID)
      .then(() => AtlasService.SetBoardObjectPosition(id, position))
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

  const dragChildOut = useCallback((node: DraggedNode, entityKind: 'note' | 'object' | 'card', reparent: (id: string, parentID: string) => void) => {
    const abs = absNode(node)
    const target = frameUnder(abs)
    if (target && target.id !== node.parentId) {
      reparent(node.id, target.id)
      return
    }
    const parentBox = boxesRef.current.find((b) => b.id === node.parentId)
    if (!parentBox) return
    const cx = abs.position.x + (node.width ?? 0) / 2
    const cy = abs.position.y + (node.height ?? 0) / 2
    const outside = cx < parentBox.x || cx > parentBox.x + parentBox.width || cy < parentBox.y || cy > parentBox.y + parentBox.height
    if (!outside) return
    const level = parentIDRef.current
    const pos = { X: abs.position.x, Y: abs.position.y }
    const chain = entityKind === 'note'
      ? AtlasService.MoveNote(node.id, level).then(() => AtlasService.SetNotePosition(node.id, pos)).then(() => undefined)
      : entityKind === 'object'
        ? AtlasService.MoveBoardObject(node.id, level).then(() => AtlasService.SetBoardObjectPosition(node.id, pos)).then(() => undefined)
        : AtlasService.MoveCard(node.id, level).then(() => AtlasService.SetPosition(node.id, pos)).then(() => undefined)
    void chain.then(() => refreshAtlas()).catch(console.error)
  }, [absNode, frameUnder])

  const onNodeDragStop = useCallback((e: MouseEvent | TouchEvent, node: DraggedNode) => {
    setHoveredFrameID(null)
    const entityKind = entityKindOf(node)
    const reparent = entityKind === 'note' ? reparentNote : entityKind === 'object' ? reparentObject : reparentCard

    // A frame child dropped past its parent's edge leaves the frame
    // (goal 0141, the drag-out symmetric of filing in): into another
    // frame when one is under the drop, else onto the board's level
    // at the dropped spot.
    if (node.parentId) {
      dragChildOut(node, entityKind, reparent)
      return
    }

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

    const pos = { X: node.position.x, Y: node.position.y }
    if (entityKind === 'note') void AtlasService.SetNotePosition(node.id, pos).catch(console.error)
    else if (entityKind === 'object') void AtlasService.SetBoardObjectPosition(node.id, pos).catch(console.error)
    else void AtlasService.SetPosition(node.id, pos).catch(console.error)
  }, [frameUnder, reparentNote, reparentCard, reparentObject, wrapperRef, dragChildOut])

  return { hoveredFrameID, onNodeDrag, onNodeDragStop }
}
