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
  // The armed-size placement runs at the WRAPPER's capture phase, not
  // onPaneClick: a click inside a frame's interior is a NODE click
  // that never reaches the pane, and filing-by-pointing must work
  // there too.
  const onWrapperClickCapture = useCallback((e: React.MouseEvent) => {
    const pending = tablePicker.pendingSize
    if (!pending) return
    // The creation tray renders INSIDE this same wrapper (chrome, not
    // canvas) -- an armed table size must place on the board, never
    // swallow a click on another tray button as a placement (goal
    // 0238: that swallow was the one path where re-arming a DIFFERENT
    // tool could never actually reach React at all). Any tray chrome
    // rendered through Primer's AnchoredOverlay (the Annotate group's
    // own popover, goal 0224, plus the pre-existing table-size/image/
    // style-panel popovers) portals to document.body -- `.closest()`
    // walks the REAL DOM, so its own content is never a descendant of
    // the tray's own testid no matter where it sits in the REACT tree.
    // AnchoredOverlay's own rendered Overlay always carries
    // `data-component="AnchoredOverlay"` (checked against the
    // installed version's own source), the one stable marker every
    // portaled tray popover shares -- matching it here is what keeps a
    // click INSIDE the Annotate group's own popover (a tool button
    // that only exists in a portal now) from being read as a canvas
    // click and stealing it from that button's own onClick.
    if (e.target instanceof Element && (e.target.closest('[data-testid="atlas-creation-tray"]') || e.target.closest('[data-component="AnchoredOverlay"]'))) return
    e.stopPropagation()
    e.preventDefault()
    // One placement per arming (the LOCKED design's own rule, same as
    // every other tool's placeAt): disarms the shared field too, not
    // just the local pendingSize, so the tray button's own indicator
    // clears along with the placement.
    tablePicker.disarm()
    const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const frameID = frameContainingPoint(topLevelBoxes, flowPos) ?? undefined
    onCreateTableSized(pending.cols, pending.rows, { X: flowPos.x, Y: flowPos.y }, frameID)
  }, [tablePicker, topLevelBoxes, screenToFlowPosition, onCreateTableSized])

  const onPaneClick = useCallback((e: { clientX: number; clientY: number }) => {
    placeAt({ x: e.clientX, y: e.clientY })
  }, [placeAt])

  return { onWrapperClickCapture, onPaneClick }
}
