import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { pencilTool } from './atlasTools'
import { frameContainingPoint } from './atlasFramePoint'
import type { PencilPoint } from './atlasPencilSvg'
import type { FrameBox } from './useAtlasDragFiling'

// The pencil tool's own placement door (goal 0169 slice 3): commits
// the drawn stroke (atlasTools.ts's pencilTool.commit writes the SVG
// mirror file) and lands it through CreateCardFromFileDrop -- the same
// door the image tool (slice 2) and native file drop already use, so
// kind resolution and duplicate detection are never re-implemented
// here. Unlike the image tool's own free-slot placement (paste/typed-
// path have no natural "where"), a stroke IS a spatial gesture: it
// lands at the FLOW position it was actually drawn at, and files into
// whichever frame it was drawn over -- the same frameContainingPoint
// resolution useAtlasNativeFileDrop.ts already applies to a native
// drop's own drop point.
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
    await AtlasService.CreateCardFromFileDrop(artifact.mirrorPath, artifact.title, targetParentID, { X: flowOrigin.x, Y: flowOrigin.y })
    await refreshAtlas()
  }

  return { landStroke }
}
