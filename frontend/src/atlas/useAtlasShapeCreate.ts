import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { shapeTool } from './tools/shapeTool'
import { frameContainingPoint } from './atlasFramePoint'
import { SHAPE_DEFAULT_FILL, type AtlasShapeType } from './atlasShapeStyleStore'
import type { ShapePoint } from './useAtlasShapeDraw'
import type { FrameBox } from './useAtlasDragFiling'

// The shape tool's own placement door (goal 0169 slice 5, following
// useAtlasPencilCreate.ts's own precedent): commits the drawn shape
// (atlasTools.ts's shapeTool.commit computes its geometry) and lands it
// as a board-local "shape" BoardObject -- never a card. A shape IS a
// spatial gesture like ink: it lands at the FLOW rect it was actually
// dragged over, filed into whichever frame its start corner was drawn
// over (the same frameContainingPoint resolution pencil/native-drop
// already apply). Unlike pencil, landing a rectangle/ellipse needs a
// second call (SetBoardObjectSize) -- CreateBoardObject itself never
// takes a Size, matching how every OTHER board object starts sizeless
// until an explicit resize; a shape's own "resize" simply happens to
// be its very first frame.
export function useAtlasShapeCreate({ parentID, topLevelBoxes, screenToFlowPosition }: {
  parentID: string
  topLevelBoxes: FrameBox[]
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
}) {
  // Returns the created object's own id (goal 0199 part D): the
  // caller leaves it selected once the tool disarms, so the resize
  // handles a drawn shape is now entitled to (part B) land on the
  // thing just made.
  const landShape = async (start: ShapePoint, end: ShapePoint, style: { shapeType: AtlasShapeType; stroke: string; strokeWidth: number }): Promise<string> => {
    const startFlow = screenToFlowPosition(start)
    const endFlow = screenToFlowPosition(end)
    const artifact = shapeTool.commit({
      shapeType: style.shapeType,
      style: { fill: SHAPE_DEFAULT_FILL, stroke: style.stroke, strokeWidth: style.strokeWidth },
      startFlow, endFlow,
    })
    const targetParentID = frameContainingPoint(topLevelBoxes, artifact.originFlow) ?? parentID
    const created = await AtlasService.CreateBoardObject('shape', artifact.payload, { X: artifact.originFlow.x, Y: artifact.originFlow.y }, targetParentID)
    if (artifact.size) await AtlasService.SetBoardObjectSize(created.ID, artifact.size)
    await refreshAtlas()
    return created.ID
  }

  return { landShape }
}
