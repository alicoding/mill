import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { thirdPartyNounFor, type ThirdPartyNounShape } from './atlasNounRegistry'
import { background } from '../shared/background'
import type { CanvasObjectExample } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { BOARD_GAP, NOTE_HEIGHT, NOTE_WIDTH } from './atlasBoardLayout'

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
  void background(createExamplePlacement(noun, flowPos, parentID), 'atlasThirdParty.createBoardObject')
  return true
}

// createExamplePlacement -- the insert-time host materialisation (goal
// 0411 S2, docs/goals/0411 Amendment): a starting payload of `{}`
// (arm-then-click's own default) with a declared example first creates
// that example's fixture notes, THEN places the object with the
// example's payload merged in -- before the object's first
// renderFace, so a fresh Mind map (etc.) shows its working example
// immediately rather than a blank picker. No plugin code runs for
// this: the host reads the declaration the frontend already holds at
// registration (ThirdPartyNounShape.example) and writes through the
// same ungated doors the tray's own New note uses.
async function createExamplePlacement(noun: ThirdPartyNounShape, flowPos: { x: number; y: number }, parentID: string): Promise<void> {
  const fixtureIds = await materializeFixtures(noun.example, flowPos, parentID)
  const payload = materializeExamplePayload({ ...noun.defaultPayload }, noun.example, fixtureIds)
  await AtlasService.CreateBoardObject(noun.boardObjectKind, payload, { X: flowPos.x, Y: flowPos.y }, parentID)
  await refreshAtlas()
}

// materializeFixtures creates one note per declared fixture (the only
// declarable fixture kind today, pluginservice_contributes.go's own
// fail-closed validation) just left of the placement point, stacked
// vertically so more than one lands legibly -- next to the object it
// feeds, matching the gallery seed's own "fixture beside its golden"
// layout. Returns each created note's id, index-aligned with
// example.fixtures for materializeExamplePayload below.
async function materializeFixtures(example: CanvasObjectExample | null, flowPos: { x: number; y: number }, parentID: string): Promise<string[]> {
  const fixtures = example?.fixtures ?? []
  const ids: string[] = []
  for (let i = 0; i < fixtures.length; i++) {
    const pos = { X: flowPos.x - (NOTE_WIDTH + BOARD_GAP), Y: flowPos.y + i * (NOTE_HEIGHT + BOARD_GAP) }
    const note = await AtlasService.CreateNote(fixtures[i].body, pos, parentID)
    ids.push(note.ID)
  }
  return ids
}

// materializeExamplePayload -- the pure merge at the center of this
// door: an EMPTY starting payload (the arm-then-click default; a
// paste/duplicate/agent placement always carries a real payload and
// passes through untouched) merges in the declared example's own
// payload, its title (the same generic Payload.title convention every
// board object honors for search/reference, atlascontents.go:120), and
// each fixture's created id at its own payloadKey -- the exact shape
// atlassvc's own gallery reconcile produces
// (reconcilePluginExampleLocked), so gallery and insert agree on one
// payload shape from two callers.
export function materializeExamplePayload(payload: Record<string, string>, example: CanvasObjectExample | null, fixtureIds: readonly string[]): Record<string, string> {
  if (Object.keys(payload).length > 0 || !example) return payload
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries(example.payload ?? {})) {
    if (value !== undefined) merged[key] = value
  }
  merged.title = example.title
  const fixtures = example.fixtures ?? []
  for (let i = 0; i < fixtures.length; i++) {
    const id = fixtureIds[i]
    if (id) merged[fixtures[i].payloadKey] = id
  }
  return merged
}
