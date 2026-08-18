import { MiniMap } from '@xyflow/react'

// React Flow's default minimap colors are hardcoded light-theme values
// (`--xy-minimap-*-default` in @xyflow/react/dist/style.css) gated
// behind a `.dark` class React Flow expects on an ancestor -- Mill
// themes via Primer's own `data-color-mode` attribute instead
// (App.tsx), so that dark-mode fallback never activates. Passing
// Primer token var() strings directly as props resolves per the
// CURRENT theme at paint time (no react-flow dark class needed), same
// as CompositionCanvas.module.css's `.canvas` class's own
// --xy-node-*/--xy-edge-* var overrides. Lives in shared/ (moved from
// composition/, goal 0106 slice B) since atlas/'s own board minimap is
// now a second consumer -- frontend.md's 2+-caller promotion rule --
// and dependency-cruiser's atlas-must-not-depend-on-composition rule
// forbids atlas/ reaching into composition/ directly. A fully self-
// contained, drop-in replacement for `<MiniMap pannable zoomable />`
// with no other props or state of its own.
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
