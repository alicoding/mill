import { MiniMap } from '@xyflow/react'

// Design-wave-1 fix #3a: React Flow's default minimap colors are
// hardcoded light-theme values (`--xy-minimap-*-default` in
// @xyflow/react/dist/style.css) gated behind a `.dark` class React
// Flow expects on an ancestor -- Mill themes via Primer's own
// `data-color-mode` attribute instead (App.tsx), so that dark-mode
// fallback never activated and the minimap stayed light-on-dark.
// Passing Primer token var() strings directly as props resolves per
// the CURRENT theme at paint time (no react-flow dark class needed),
// same as CompositionCanvas.module.css's `.canvas` class's own
// --xy-node-*/--xy-edge-* var overrides. Split into its own file
// (rather than inlined in CompositionCanvas.tsx) once that file
// crossed the 500-line limit (.claude/rules/architecture.md) -- a
// clean seam, since this is a fully self-contained, drop-in
// replacement for `<MiniMap pannable zoomable />` with no other props
// or state of its own.
export function ThemedMiniMap() {
  return (
    <MiniMap
      pannable
      zoomable
      bgColor="var(--bgColor-inset)"
      maskColor="var(--overlay-backdrop-bgColor)"
      nodeColor="var(--fgColor-muted)"
      nodeStrokeColor="var(--borderColor-default)"
    />
  )
}
