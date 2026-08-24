import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { pencilTool } from './tools/pencilTool'
import { frameContainingPoint } from './atlasFramePoint'
import type { PencilPoint } from './atlasPencilSvg'
import type { FrameBox } from './useAtlasDragFiling'

// The pencil tool's own placement door (goal 0169 slice 3, re-pointed
// by goal 0179 S1's own correction): commits the drawn stroke
// (atlasTools.ts's pencilTool.commit writes the baked SVG mirror file)
// and lands it as a board-local "ink" BoardObject -- never a card, and
// never a commit ceremony that interrupts drawing (each stroke is its
// own object; consecutive strokes simply add more ink, nothing
// defocuses into anything). Unlike the image tool's own free-slot
// placement (paste/typed-path have no natural "where"), a stroke IS a
// spatial gesture: it lands at the FLOW position it was actually drawn
// at, and files into whichever frame it was drawn over -- the same
// frameContainingPoint resolution useAtlasNativeFileDrop.ts already
// applies to a native drop's own drop point.
export function useAtlasPencilCreate({ parentID, topLevelBoxes, screenToFlowPosition }: {
  parentID: string
  topLevelBoxes: FrameBox[]
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
}) {
  const landStroke = async (points: PencilPoint[], color: string, size: number) => {
    const artifact = await pencilTool.commit({ points, color, size })
    if (!artifact) return
    const flowOrigin = screenToFlowPosition({ x: artifact.originX, y: artifact.originY })
    const targetParentID = frameContainingPoint(topLevelBoxes, flowOrigin) ?? parentID
    // title rides along in Payload purely for a later Promote to
    // card's own popover default -- see useAtlasImageCreate.ts's own
    // comment on why (a board-local object has no title of its own).
    await AtlasService.CreateBoardObject('ink', { mirrorPath: artifact.mirrorPath, title: artifact.title }, { X: flowOrigin.x, Y: flowOrigin.y }, targetParentID)
    await refreshAtlas()
  }

  return { landStroke }
}
