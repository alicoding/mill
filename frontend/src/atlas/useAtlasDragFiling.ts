import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { freeChildPosition } from './atlasContainmentPlacement'
import { background } from '../shared/background'
import { computeGuides, createGuideChannel, guideThreshold, type Box, type GuideChannel } from './alignmentGuides'

export interface FrameBox { id: string; x: number; y: number; width: number; height: number; isFrame: boolean }
// A box that can be aligned against but never filed into: notes and
// board objects hold no children, so they carry no isFrame flag.
export interface PeerBox { id: string; x: number; y: number; width: number; height: number }
interface DraggedNode { id: string; type?: string; parentId?: string; position: { x: number; y: number }; width?: number | null; height?: number | null; measured?: { width?: number; height?: number } | null }

interface Snap { dx: number; dy: number }
const NO_SNAP: Snap = { dx: 0, dy: 0 }

// A node's box in the same units computeTopLevelBoxes produces: the
// declared layout size first (that is what the peer boxes are built
// from), `measured` only for the families that carry no declared size.
function boxOf(node: DraggedNode, position: { x: number; y: number }): Box {
  return {
    id: node.id,
    x: position.x,
    y: position.y,
    w: node.width ?? node.measured?.width ?? 0,
    h: node.height ?? node.measured?.height ?? 0,
  }
}

// The dragged set: React Flow moves an entire selection by one shared
// pointer delta, so a snap correction applies to all of them and the
// selection stays rigid.
function draggedSet(node: DraggedNode, nodes?: DraggedNode[]): DraggedNode[] {
  return nodes && nodes.length > 0 ? nodes : [node]
}

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
export function useAtlasDragFiling({ allCards, parentID, topLevelBoxes, noteBoxes, objectBoxesRef, wrapperRef }: {
  allCards: Card[]
  parentID: string
  topLevelBoxes: FrameBox[]
  noteBoxes: PeerBox[]
  // A ref, not a prop: an object's box derives from React Flow's own
  // measured nodes, which AtlasBoard writes back into this ref after
  // every measure pass.
  objectBoxesRef: RefObject<PeerBox[]>
  wrapperRef: RefObject<HTMLDivElement | null>
}) {
  const [hoveredFrameID, setHoveredFrameID] = useState<string | null>(null)
  // Latest-refs, synced via effect rather than during render
  // (useBoardFocus.ts's own convention) -- every callback below is
  // useCallback-wrapped with an empty/stable dependency list so its
  // own identity never churns the RF prop it's passed as.
  const boxesRef = useRef(topLevelBoxes)
  const noteBoxesRef = useRef(noteBoxes)
  const allCardsRef = useRef(allCards)
  const parentIDRef = useRef(parentID)
  useEffect(() => {
    boxesRef.current = topLevelBoxes
    noteBoxesRef.current = noteBoxes
    allCardsRef.current = allCards
    parentIDRef.current = parentID
  }, [topLevelBoxes, noteBoxes, allCards, parentID])

  const { updateNode, getZoom } = useReactFlow()
  // The overlay's own channel (goal 0161 slice 2): guides never live
  // in this hook's state -- see alignmentGuides.ts's createGuideChannel.
  const [guideChannel] = useState<GuideChannel>(createGuideChannel)
  const snapRef = useRef<{ id: string; dx: number; dy: number } | null>(null)

  // ONE walk of the board's boxes serves BOTH the drag's release target
  // and its alignment peers (goal 0161 slice 2) -- the guide comparison
  // must never cost a second pass over the same list. `excludeIDs`
  // names every node moving with this drag (the whole selection on a
  // multi-drag); a node can never align against itself.
  //
  // EVERY top-level box is a peer -- cards, notes and board objects
  // alike -- so a card lines up against a sticky note or a shape the
  // same way it lines up against another card. Only cards can be a
  // release TARGET, since only a card can become a region frame, so
  // the frame test runs over the card list alone.
  const scanBoxes = useCallback((node: DraggedNode, excludeIDs?: Set<string>) => {
    const cx = node.position.x + (node.width ?? 0) / 2
    const cy = node.position.y + (node.height ?? 0) / 2
    let target: FrameBox | null = null
    const peers: Box[] = []
    const asPeer = (b: PeerBox) => {
      if (excludeIDs && !excludeIDs.has(b.id)) peers.push({ id: b.id, x: b.x, y: b.y, w: b.width, h: b.height })
    }
    for (const b of boxesRef.current) {
      if (target === null && b.isFrame && b.id !== node.id && cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height) target = b
      asPeer(b)
    }
    for (const b of noteBoxesRef.current) asPeer(b)
    for (const b of objectBoxesRef.current) asPeer(b)
    return { target, peers }
  }, [objectBoxesRef])

  const frameUnder = useCallback((node: DraggedNode) => scanBoxes(node).target, [scanBoxes])

  // absNode lifts a frame child's parent-relative position to board
  // coordinates so the same intersection tests apply (goal 0141).
  const absNode = useCallback((node: DraggedNode): DraggedNode => {
    if (!node.parentId) return node
    const parentBox = boxesRef.current.find((b) => b.id === node.parentId)
    if (!parentBox) return node
    return { ...node, position: { x: parentBox.x + node.position.x, y: parentBox.y + node.position.y } }
  }, [])

  // React Flow's single-node door: updateNode rewrites one entry of
  // the nodes array and leaves every other node object's identity
  // intact, so a snapped drag frame never invalidates a memo'd node
  // the way a whole-array rebuild does (goal 0161 slice 1; xyflow
  // #4593). Never reach for setNodes here.
  //
  // The corrected position is built from the position React Flow hands
  // in ON THE EVENT, never read back out of the nodes array: the array
  // trails the drag by a frame, so an updater reading `node.position`
  // there lands the correction on the PREVIOUS frame's coordinate and
  // silently swallows one pointer step of movement.
  const applySnap = useCallback((moving: DraggedNode[], snap: Snap) => {
    if (snap.dx === 0 && snap.dy === 0) return
    for (const n of moving) {
      updateNode(n.id, { position: { x: n.position.x + snap.dx, y: n.position.y + snap.dy } })
    }
  }, [updateNode])

  const onNodeDrag = useCallback((e: MouseEvent | TouchEvent, node: DraggedNode, nodes?: DraggedNode[]) => {
    const abs = absNode(node)
    const moving = draggedSet(node, nodes)
    const { target, peers } = scanBoxes(abs, new Set(moving.map((n) => n.id)))
    setHoveredFrameID(target && target.id !== node.parentId ? target.id : null)

    // ⌘ suspends alignment for as long as it is held -- the momentary
    // escape hatch for a deliberately unaligned placement.
    if (e.metaKey) {
      guideChannel.publish([])
      snapRef.current = null
      return
    }
    const { guides, snap } = computeGuides(boxOf(node, abs.position), peers, guideThreshold(getZoom()))
    // The snap is queued BEFORE the guides are published: publishing
    // notifies the overlay's store subscriber, so both land in the same
    // React commit and the line can never paint a frame ahead of the
    // position it is measuring.
    applySnap(moving, snap)
    guideChannel.publish(guides)
    // The drop persists the snap the last frame SHOWED, rather than
    // recomputing at release: what settled under the pointer is what
    // gets written.
    snapRef.current = { id: node.id, ...snap }
  }, [scanBoxes, absNode, applySnap, guideChannel, getZoom])

  const reparentNote = useCallback((id: string, newParentID: string) => {
    const position = freeChildPosition(allCardsRef.current, newParentID)
    void background(AtlasService.MoveNote(id, newParentID)
      .then(() => AtlasService.SetNotePosition(id, position))
      .then(() => refreshAtlas()), 'atlasDragFiling.setNotePosition')
  }, [])

  const reparentCard = useCallback((id: string, newParentID: string) => {
    const position = freeChildPosition(allCardsRef.current, newParentID)
    void background(AtlasService.MoveCard(id, newParentID)
      .then(() => AtlasService.SetPosition(id, position))
      .then(() => refreshAtlas()), 'atlasDragFiling.setPosition')
  }, [])

  // Board objects (goal 0179/0180) share the exact same drag-filing
  // shape as notes -- their own reparent + set-position pair, wired the
  // same way in the entityKindOf dispatch below.
  const reparentObject = useCallback((id: string, newParentID: string) => {
    const position = freeChildPosition(allCardsRef.current, newParentID)
    void background(AtlasService.MoveBoardObject(id, newParentID)
      .then(() => AtlasService.SetBoardObjectPosition(id, position))
      .then(() => refreshAtlas()), 'atlasDragFiling.setBoardObjectPosition')
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
    void background(chain.then(() => refreshAtlas()), 'atlasDragFiling.reparent')
  }, [absNode, frameUnder])

  const onNodeDragStop = useCallback((e: MouseEvent | TouchEvent, dropped: DraggedNode, nodes?: DraggedNode[]) => {
    setHoveredFrameID(null)
    guideChannel.publish([])
    // React Flow re-applies the RAW pointer position to every drag
    // item immediately before this handler runs, so the snap has to be
    // laid back on top here -- otherwise the node visibly jumps off
    // its guide at the moment of release.
    const pending = snapRef.current
    snapRef.current = null
    const snap = pending && pending.id === dropped.id ? { dx: pending.dx, dy: pending.dy } : NO_SNAP
    applySnap(draggedSet(dropped, nodes), snap)
    const node: DraggedNode = snap === NO_SNAP
      ? dropped
      : { ...dropped, position: { x: dropped.position.x + snap.dx, y: dropped.position.y + snap.dy } }
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
    if (entityKind === 'note') void background(AtlasService.SetNotePosition(node.id, pos), 'atlasDragFiling.setNotePosition')
    else if (entityKind === 'object') void background(AtlasService.SetBoardObjectPosition(node.id, pos), 'atlasDragFiling.setBoardObjectPosition')
    else void background(AtlasService.SetPosition(node.id, pos), 'atlasDragFiling.setPosition')
  }, [frameUnder, reparentNote, reparentCard, reparentObject, wrapperRef, dragChildOut, applySnap, guideChannel])

  return { hoveredFrameID, onNodeDrag, onNodeDragStop, guideChannel }
}
