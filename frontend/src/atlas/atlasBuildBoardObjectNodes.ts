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
// width/height stay UNSET until a resize persists BoardObject.Size
// (goal 0199 part B) -- exactly like a sticky mid-edit, the object's
// own rendered content dictates its footprint until then (clamped by
// AtlasBoardObjectNode.module.css) rather than a fixed card-shaped
// box. Once Size exists, it's threaded straight onto the RF node the
// same way atlasBuildBoardNodes.ts already does for a table CARD --
// the node's own resize handles (AtlasBoardObjectNode.tsx's shared
// NodeResizer) and the persisted box need to agree on one number.
//
// zIndex fixes ink ABOVE image/shape regardless of creation/array order
// (the acceptance contract's own "drawing over a screenshot works",
// goal 0169 slice 5 extending it to "ink can be drawn on top of
// shapes"): shape joins image's own tier -- both are peer surfaces ink
// annotates -- so a third kind stays on this same tier by default
// unless it too needs to be an annotation layer. table/diagram (goal
// 0179 S2) join the same annotatable tier: the nouns table's own "Ink
// on it: yes" applies to every board-local surface, not only the
// image/shape pair it first shipped for.
// This map is the ONE place board-object stacking is decided --
// AtlasBoard.tsx's own elevateNodesOnSelect={false} exists purely to
// protect it: React Flow's default bumps whichever node is SELECTED
// to a z far above any declared value, which silently broke "ink above
// shape" the moment a just-drawn shape (left selected by goal 0199's
// own one-shot contract) had ink drawn over it -- the shape jumped to
// z 1000, ink stayed at 1, so the shape painted on top despite this
// map ranking it lower (goal 0208 defect 4, reproduced live: a
// selected object's rendered `.react-flow__node` carried
// `style.zIndex: "1000"` against ink's own declared `"1"`).
const OBJECT_Z_INDEX: Record<string, number> = { image: 0, shape: 0, table: 0, diagram: 0, ink: 1 }

export function buildBoardObjectNodes({ objects, readOnly, isFree, soleSelectedID = null, pulsedID = null }: {
  objects: BoardObject[]
  readOnly: boolean
  isFree: boolean
  // The board's jump/entry pulse target (goal 0265): objects are ⌘K
  // jump peers, so the same one-shot pulse card nodes render lands
  // here too. Optional/defaulted like soleSelectedID, same reason.
  pulsedID?: string | null
  // The board's own sole-selected object id, if any (goal 0214) --
  // threaded through so AtlasBoardObjectNode.tsx can show the shape
  // rotation handle only on that ONE node, never derived per-node from
  // React Flow's own per-node `selected` (which can't distinguish
  // "sole" from "part of a multi-selection"). Optional/defaulted so
  // every pre-existing call site (including this file's own test)
  // keeps compiling unmodified.
  soleSelectedID?: string | null
}): AtlasBoardObjectRFNode[] {
  return objects.map((object) => ({
    id: object.ID,
    type: 'atlas-object',
    position: { x: object.Position.X, y: object.Position.Y },
    draggable: isFree && !readOnly,
    zIndex: OBJECT_Z_INDEX[object.Kind] ?? 0,
    ...(object.Size ? { width: object.Size.W, height: object.Size.H } : {}),
    data: { object, soleSelected: object.ID === soleSelectedID, pulsed: object.ID === pulsedID },
  }))
}
