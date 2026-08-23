import type { Card, Position } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { freeChildPosition } from './atlasContainmentPlacement'
import { imageTool } from './atlasTools'

// The image tool's own placement door (goal 0169 slice 2): both
// paste-or-drop sub-gestures resolve to a mirrorPath (imageTool.commit),
// then land through CreateCardFromFileDrop -- the exact same door a
// native OS file drop already uses, so kind resolution and duplicate
// detection are never re-implemented here. Split into its own hook
// (rather than folding into useAtlasCardCreate.ts) since AtlasBoard.tsx
// already receives allCards/viewedID as props and has no reason to
// thread a new callback down through AtlasView.tsx to reach them.
export function useAtlasImageCreate({ allCards, viewedID }: { allCards: Card[]; viewedID: string }) {
  const land = async (mirrorPath: string, title: string) => {
    const position: Position | null = freeChildPosition(allCards, viewedID)
    await AtlasService.CreateCardFromFileDrop(mirrorPath, title, viewedID, position)
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
