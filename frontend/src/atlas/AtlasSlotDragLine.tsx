import type { AtlasSlotDragLine as AtlasSlotDragLineShape } from './useAtlasSlotDrag'

// The dashed accent connection line following the pointer during a
// slot-drag (goal 0081 slice A4, LOCKED design §3's mid-drag scene) --
// a fixed full-viewport SVG overlay in raw client coordinates, since
// useAtlasSlotDrag already tracks the gesture in screen space; no
// React Flow viewport transform to account for.
export function AtlasSlotDragLine({ line }: { line: AtlasSlotDragLineShape }) {
  return (
    <svg
      data-testid="atlas-slot-drag-line"
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 1001 }}
    >
      <line
        x1={line.x1}
        y1={line.y1}
        x2={line.x2}
        y2={line.y2}
        stroke="var(--fgColor-accent)"
        strokeWidth={2}
        strokeDasharray="6 5"
      />
    </svg>
  )
}
