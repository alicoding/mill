import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { thirdPartyNounFor } from './atlasNounRegistry'

// placeThirdPartyObject -- the ONE generic placement for every
// runtime-registered noun (docs/goals/0249): the armed click creates a
// BoardObject of the declared kind with its declared default payload,
// through the same content-plane door built-ins use. Returns false for
// a non-third-party tool so the caller's built-in branches proceed.
export function placeThirdPartyObject(toolId: string, flowPos: { x: number; y: number }, parentID: string): boolean {
  const noun = thirdPartyNounFor(toolId)
  if (!noun) return false
  // A drag-shaped plugin tool (goal 0252 S1) creates through its own
  // gesture.onEnd, never an armed click -- claim the click (built-in
  // branches must not proceed for a third-party tool) but place
  // nothing, matching how a built-in drag tool's stray click no-ops.
  if (noun.interaction !== 'arm-then-click') return true
  void AtlasService.CreateBoardObject(noun.boardObjectKind, { ...noun.defaultPayload }, { X: flowPos.x, Y: flowPos.y }, parentID)
    .then(() => refreshAtlas())
    .catch(console.error)
  return true
}
