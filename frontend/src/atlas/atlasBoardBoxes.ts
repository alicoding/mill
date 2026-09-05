import type { BoardObject, Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { computeGroupFrameLayout, isGroupCard, NOTE_HEIGHT, NOTE_WIDTH, STICKY_HEIGHT, STICKY_WIDTH, TABLE_HEIGHT, TABLE_WIDTH } from './atlasBoardLayout'
import { rotatedAABB } from './atlasRotation'
import type { FrameBox } from './useAtlasDragFiling'

// Every top-level card's own rendered flow-space box (goal 0081
// slice A2): shared by the marker-box's own enclosure test, drag
// filing's frame-intersection test, and the "you'd file into me"
// highlight. Pure derivation split out of AtlasBoard.tsx at the
// 500-line seam; the caller keeps the isFree gate (a card's Position,
// and therefore this box, is meaningless in Auto-arrange).
export function computeTopLevelBoxes(
  cards: Card[],
  allCards: Card[],
  freeMoves: { id: string; x: number; y: number }[],
  allNotes: Note[],
  allObjects: BoardObject[],
): FrameBox[] {
  const moveByID = new Map(freeMoves.map((m) => [m.id, m]))
  return cards.map((card) => {
    const move = moveByID.get(card.ID)
    const frame = isGroupCard(allCards, card, allNotes, allObjects)
    // The same three branches atlasBuildBoardNodes renders and
    // computeAutoArrangeLayout packs at, so a box here always matches
    // the face on screen: a frame at its laid-out size, a List
    // projection at its table face, everything else at the note face
    // -- each with a persisted resize (Card.Size) winning over the
    // default. A box that disagrees with the rendered face mis-aims
    // every consumer of it: the drop-target test, the "you'd file into
    // me" highlight, and alignment peers.
    const size = frame
      ? computeGroupFrameLayout(allCards, card.ID, allNotes, allObjects).size
      : card.ProjectionListID
        ? { width: card.Size?.W ?? TABLE_WIDTH, height: card.Size?.H ?? TABLE_HEIGHT }
        : { width: card.Size?.W ?? NOTE_WIDTH, height: card.Size?.H ?? NOTE_HEIGHT }
    return {
      id: card.ID,
      x: move?.x ?? card.Position?.X ?? 0,
      y: move?.y ?? card.Position?.Y ?? 0,
      width: size.width,
      height: size.height,
      isFrame: frame,
    }
  })
}

export function computeNoteBoxes(notes: Note[]): { id: string; x: number; y: number; width: number; height: number }[] {
  return notes.map((n) => ({ id: n.ID, x: n.Position.X, y: n.Position.Y, width: STICKY_WIDTH, height: STICKY_HEIGHT }))
}

// Every board object's own rendered flow-space box, rotation-aware
// (goal 0230's measured w/h, corrected by goal 0236's audit: a rotated
// shape's real screen footprint extends past its unrotated measured
// size, so the eraser/laser tools' own point-in-box hit test needs the
// rotated AABB, not the raw one). rotatedAABB degenerates to the
// identity box for every Kind with no `rotation` payload key at all,
// so this stays exact for them too. Split out of AtlasBoard.tsx at the
// 500-line seam, mirroring computeTopLevelBoxes/computeNoteBoxes above.
// Objects FILED into a region frame are excluded: React Flow positions
// a parented node relative to its parent, so a filed object's node
// position is not a board coordinate at all, and a box built from it
// names a rectangle that is nowhere on screen. Those previews are inert
// by construction (atlasBuildBoardNodes gives them `preview: true` and
// `draggable: false`), so every consumer of this list -- free
// placement, marker-box enclosure, the eraser/laser hit tests and
// alignment peers -- wants the level's own objects and not them. Drill
// into the frame and its children become top-level nodes, appearing
// here in real board coordinates.
export function computeObjectBoxes(nodes: { id: string; position: { x: number; y: number }; parentId?: string; measured?: { width?: number; height?: number }; data: unknown }[]): { id: string; x: number; y: number; width: number; height: number }[] {
  return nodes.filter((n) => !n.parentId).map((n) => {
    const object = (n.data as { object?: { Payload?: Record<string, string> } }).object
    const rotation = Number(object?.Payload?.rotation) || 0
    const box = rotatedAABB(n.position.x, n.position.y, n.measured?.width ?? 0, n.measured?.height ?? 0, rotation)
    return { id: n.id, ...box }
  })
}

// Every card nested ONE level inside a top-level region frame, in the
// SAME absolute flow-space coordinates topLevelBoxes already uses
// (goal 0124 slice 2): computeGroupFrameLayout's own child positions
// are relative to their frame (React Flow's parentId/extent:'parent'
// convention), so a release point landing visually on a nested card
// must be translated back to absolute space before it can be told
// apart from its enclosing frame. Without this, a link-drag release
// over a nested card's own preview tile resolved to the FRAME's card
// instead -- the release point fell inside the frame's box (the only
// box on offer) and never matched the smaller nested tile beneath it.
export function computeNestedCardBoxes(topLevelBoxes: FrameBox[], allCards: Card[], allNotes: Note[], allObjects: BoardObject[]): FrameBox[] {
  const boxes: FrameBox[] = []
  for (const frame of topLevelBoxes) {
    if (!frame.isFrame) continue
    for (const child of computeGroupFrameLayout(allCards, frame.id, allNotes, allObjects).children) {
      boxes.push({
        id: child.card.ID,
        x: frame.x + child.position.x,
        y: frame.y + child.position.y,
        width: child.size.width,
        height: child.size.height,
        isFrame: child.variant === 'chip',
      })
    }
  }
  return boxes
}

// Select-then-group's own anchor (the multi-select context menu item
// and the selection tray's Group button/bare-G): the new container's
// Position is the enclosed members' own CURRENT rendered top-left, not
// the triggering click point -- a click on a member (or the tray's
// bottom-center button) is nowhere near the members themselves. Null
// when none of the given ids resolve to a box (nothing to anchor to;
// the caller falls back to the click-derived flow position).
export function computeEnclosedBoundingBoxOrigin(
  cardIDs: string[],
  noteIDs: string[],
  objectIDs: string[],
  cardBoxes: { id: string; x: number; y: number }[],
  noteBoxes: { id: string; x: number; y: number }[],
  objectBoxes: { id: string; x: number; y: number }[],
): { x: number; y: number } | null {
  const ids = new Set([...cardIDs, ...noteIDs, ...objectIDs])
  const boxes = [...cardBoxes, ...noteBoxes, ...objectBoxes].filter((b) => ids.has(b.id))
  if (boxes.length === 0) return null
  return {
    x: Math.min(...boxes.map((b) => b.x)),
    y: Math.min(...boxes.map((b) => b.y)),
  }
}
