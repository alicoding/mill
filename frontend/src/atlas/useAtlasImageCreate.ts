import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { freeChildPosition } from './atlasContainmentPlacement'
import { imageTool } from './atlasTools'

// The image tool's own placement door (goal 0169 slice 2, re-pointed by
// goal 0179 S1's own correction): both paste-or-drop sub-gestures
// resolve to a mirrorPath (imageTool.commit), then land as a
// board-local BoardObject -- a peer to Card, never a card itself
// (dropping/drawing on the canvas creates THAT THING, never a
// document). Split into its own hook (rather than folding into
// useAtlasCardCreate.ts) since AtlasBoard.tsx already receives
// allCards/viewedID as props and has no reason to thread a new
// callback down through AtlasView.tsx to reach them.
export function useAtlasImageCreate({ allCards, viewedID }: { allCards: Card[]; viewedID: string }) {
  // title rides along in Payload alongside mirrorPath (never used for
  // anything an object itself renders -- board-local objects have no
  // title) purely so a later Promote to card's own popover can prefill
  // this artifact's own clean name instead of re-deriving one from the
  // mirror file's own randomized-suffix filename.
  const land = async (mirrorPath: string, title: string) => {
    const position = freeChildPosition(allCards, viewedID) ?? { X: 0, Y: 0 }
    await AtlasService.CreateBoardObject('image', { mirrorPath, title }, position, viewedID)
    await refreshAtlas()
  }

  const createFromPath = async (path: string) => {
    const artifact = await imageTool.commit({ path })
    await land(artifact.mirrorPath, artifact.title)
  }

  const createFromFile = async (file: File) => {
    const artifact = await imageTool.commit({ file, title: 'Pasted image' })
    await land(artifact.mirrorPath, artifact.title)
  }

  return { createFromPath, createFromFile }
}
