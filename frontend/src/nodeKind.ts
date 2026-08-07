// Shared by CompositionCanvas.tsx (canvas node chrome, palette) and
// CompositionView.tsx (node-primitives list, saved-workflow chip chain)
// -- split into its own module rather than co-located with a component
// so Fast Refresh doesn't warn about a non-component export.
export const KIND_VARIANT: Record<string, 'accent' | 'success' | 'severe'> = {
  capture: 'accent',
  process: 'success',
  apply: 'severe',
}
