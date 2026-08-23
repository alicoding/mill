import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useAtlasEraserDraw } from './useAtlasEraserDraw'
import { useAtlasLaserDraw } from './useAtlasLaserDraw'
import type { FrameBox } from './useAtlasDragFiling'
import type { AtlasArmableTool } from './atlasTools'

export interface DragGestureHandlers {
  onPointerDown: (e: ReactPointerEvent) => void
  onPointerMove: (e: ReactPointerEvent) => void
  onPointerUp: (e: ReactPointerEvent) => void
}

// The four hand-rolled canvas drags (Area's marquee, Pencil's stroke,
// Eraser's pass, Laser's trail) are mutually exclusive by construction
// (armedTool holds at most one value) -- resolved as a pure lookup
// rather than a nested ternary chain, so each new drag tool this
// registry gains adds an array entry here instead of raising
// AtlasBoard.tsx's own branching.
function firstArmedDrag(entries: [boolean, DragGestureHandlers][]): DragGestureHandlers | null {
  return entries.find(([armed]) => armed)?.[1] ?? null
}

// Eraser and Laser's own arming + gesture-hook wiring (goal 0169 slice
// 4), split out of AtlasBoard.tsx at the 500-line seam -- Area and
// Pencil stay wired directly in AtlasBoard.tsx (they predate this
// split and nothing about slice 4 required moving them), this hook
// only takes their ALREADY-INSTANTIATED armed flag + drag handlers as
// input so `activeDrag`'s four-way resolution has one home regardless
// of where each tool's own hook call happens to live.
export function useAtlasDragTools({
  isFree, readOnly, armedTool, screenToFlowPosition, topLevelBoxes, noteBoxes, wrapperRef, onDeleteSelection,
  areaArmed, areaDraw, pencilArmed, pencilDraw,
}: {
  isFree: boolean
  readOnly: boolean
  armedTool: AtlasArmableTool | null
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  topLevelBoxes: FrameBox[]
  noteBoxes: { id: string; x: number; y: number; width: number; height: number }[]
  wrapperRef: RefObject<HTMLDivElement | null>
  onDeleteSelection: (cardIDs: string[], noteIDs: string[]) => void
  areaArmed: boolean
  areaDraw: DragGestureHandlers
  pencilArmed: boolean
  pencilDraw: DragGestureHandlers
}) {
  // Eraser: armed the same click-to-arm way Pencil is, and stays armed
  // across passes for the same "sticky tool" reason. onComplete hands
  // its WHOLE accumulated hit set to this board's own onDeleteSelection
  // prop directly -- the exact door the selection tray's Delete key
  // already uses -- so deletion rides goal 0093's quick-delete-WITH-UNDO
  // guard rather than a bespoke pipeline; see atlasTools.ts's own
  // eraserTool comment for why this makes the tool recoverable, not
  // destructive.
  const eraserArmed = isFree && !readOnly && armedTool === 'eraser'
  const eraserDraw = useAtlasEraserDraw({
    armed: eraserArmed, screenToFlowPosition, cardBoxes: topLevelBoxes, noteBoxes, wrapperRef,
    onComplete: onDeleteSelection,
  })

  // Laser: armed the same way, but the hook itself never disarms OR
  // commits anything -- it renders from local state only and fades on
  // its own (useAtlasLaserDraw.ts).
  const laserArmed = isFree && !readOnly && armedTool === 'laser'
  const laserDraw = useAtlasLaserDraw({ armed: laserArmed, wrapperRef })

  const activeDrag = firstArmedDrag([[areaArmed, areaDraw], [pencilArmed, pencilDraw], [eraserArmed, eraserDraw], [laserArmed, laserDraw]])
  const anyDragToolArmed = activeDrag !== null

  return { eraserArmed, eraserDraw, laserArmed, laserDraw, activeDrag, anyDragToolArmed }
}
