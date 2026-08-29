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
  void AtlasService.CreateBoardObject(noun.boardObjectKind, { ...noun.defaultPayload }, { X: flowPos.x, Y: flowPos.y }, parentID)
    .then(() => refreshAtlas())
    .catch(console.error)
  return true
}
