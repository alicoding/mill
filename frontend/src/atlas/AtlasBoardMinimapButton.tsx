import { ControlButton } from '@xyflow/react'
import { AppsIcon } from '@primer/octicons-react'

// The board's own minimap on/off button (goal 0106 slice B contract
// item 5) -- split out of AtlasBoard.tsx at the 500-line seam
// (architecture.md). Must render as a DIRECT child of React Flow's
// <Controls> to seat in its own zoom/fit-view button cluster; the
// ThemedMiniMap panel itself renders as ReactFlow's own sibling, not
// nested here, so AtlasBoard.tsx still renders that half directly.
export function AtlasBoardMinimapButton({ visible, onToggle, ariaLabel }: {
  visible: boolean
  onToggle: () => void
  ariaLabel: string
}) {
  return (
    <ControlButton onClick={onToggle} aria-label={ariaLabel} aria-pressed={visible} data-testid="atlas-minimap-toggle">
      <AppsIcon size={12} />
    </ControlButton>
  )
}
