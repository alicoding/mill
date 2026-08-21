import { useCallback } from 'react'
import { frameContainingPoint } from './atlasFramePoint'
import type { FrameBox } from './useAtlasDragFiling'
import type { useTablePickerSignal } from './useTablePickerSignal'

// The board's one pane-click handler (split out of AtlasBoard.tsx at
// the 500-line convention): an armed table size places at the click
// (goal 0148), filing into the frame under the point; otherwise the
// click is an armed tool's placement (useAtlasCreation.placeAt).
export function useAtlasPaneClick({ tablePicker, topLevelBoxes, screenToFlowPosition, onCreateTableSized, placeAt }: {
  tablePicker: ReturnType<typeof useTablePickerSignal>
  topLevelBoxes: FrameBox[]
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  onCreateTableSized: (cols: number, rows: number, at?: { X: number; Y: number }, parentID?: string) => void
  placeAt: (p: { x: number; y: number }) => void
}) {
  return useCallback((e: { clientX: number; clientY: number }) => {
    const pending = tablePicker.pendingSize
    if (pending) {
      tablePicker.setPendingSize(null)
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const frameID = frameContainingPoint(topLevelBoxes, flowPos) ?? undefined
      onCreateTableSized(pending.cols, pending.rows, { X: flowPos.x, Y: flowPos.y }, frameID)
      return
    }
    placeAt({ x: e.clientX, y: e.clientY })
  }, [tablePicker, topLevelBoxes, screenToFlowPosition, onCreateTableSized, placeAt])
}
