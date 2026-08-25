import { useKeyPress } from '@xyflow/react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { DragGestureHandlers } from './useAtlasDragTools'

// Space-hold panning while a drag tool stays armed (goal 0208 defect
// 2): React Flow's own panActivationKeyCode ('Space', its own default,
// verified against the installed package's source) already re-enables
// pane panning the instant Space is held, overriding this board's own
// panOnDrag={false} -- but only once Mill's OWN capture-phase pointer
// handlers step aside, since useAtlasPencilDraw.ts (and its Eraser/
// Laser/Shape/Area siblings) call stopPropagation() on an ancestor of
// the pane specifically so React Flow never sees the gesture at all.
// useKeyPress is the exact primitive React Flow uses internally for
// the same key, adopted here rather than hand-rolled so the two Space
// definitions can never drift apart -- its own isInputDOMNode guard
// already skips a Space held while typing a card title, so this needs
// no input guard of its own.
export function useAtlasPanActivation(activeDrag: DragGestureHandlers | null) {
  const panning = useKeyPress('Space') && activeDrag !== null
  const guard = (handler: (e: ReactPointerEvent) => void) => (e: ReactPointerEvent) => {
    if (!panning) handler(e)
  }
  return {
    panning,
    onPointerDown: activeDrag ? guard(activeDrag.onPointerDown) : undefined,
    onPointerMove: activeDrag ? guard(activeDrag.onPointerMove) : undefined,
    onPointerUp: activeDrag ? guard(activeDrag.onPointerUp) : undefined,
  }
}
