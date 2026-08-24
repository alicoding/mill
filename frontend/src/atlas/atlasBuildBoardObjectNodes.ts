import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { AtlasBoardObjectRFNode } from './AtlasBoardObjectNode'

// Builds every board-local canvas object's own React Flow node (goal
// 0179/0180) -- its own file, mirroring atlasStickyNodes.ts's own split
// from AtlasBoard.tsx's builtNodes memo. One node TYPE for every kind
// (image, ink, ...): AtlasBoardObjectNode itself picks its fallback
// glyph off object.Kind, so a third kind never needs a second builder
// or a second registry entry here -- only a Payload-key convention and
// a case inside that one component.
//
// No explicit width/height (like a sticky mid-edit): the object's own
// rendered content dictates its footprint, so it lands at its natural/
// intrinsic size (clamped by AtlasBoardObjectNode.module.css) rather
// than a fixed card-shaped box.
//
// zIndex fixes ink ABOVE image/shape regardless of creation/array order
// (the acceptance contract's own "drawing over a screenshot works",
// goal 0169 slice 5 extending it to "ink can be drawn on top of
// shapes"): shape joins image's own tier -- both are peer surfaces ink
// annotates -- so a third kind stays on this same tier by default
// unless it too needs to be an annotation layer.
const OBJECT_Z_INDEX: Record<string, number> = { image: 0, shape: 0, ink: 1 }

export function buildBoardObjectNodes({ objects, readOnly, isFree }: {
  objects: BoardObject[]
  readOnly: boolean
  isFree: boolean
}): AtlasBoardObjectRFNode[] {
  return objects.map((object) => ({
    id: object.ID,
    type: 'atlas-object',
    position: { x: object.Position.X, y: object.Position.Y },
    draggable: isFree && !readOnly,
    zIndex: OBJECT_Z_INDEX[object.Kind] ?? 0,
    data: { object },
  }))
}
