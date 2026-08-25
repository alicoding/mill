// Thin re-export shim (goal 0209): the pencil tool's own style state
// now lives in the one generic store (atlasStyleValueStore.ts), keyed
// by noun id rather than one bespoke store per noun. This file stays
// only so AtlasBoard.tsx's existing import continues to resolve without
// an import-path edit for one rename.
export { PENCIL_COLORS, PENCIL_SIZES, useAtlasPencilStyle } from './atlasStyleValueStore'
