// Thin re-export shim (goal 0209): the shape tool's own style state now
// lives in the one generic store (atlasStyleValueStore.ts), keyed by
// noun id rather than one bespoke store per noun. This file stays only
// so callers that imported these names before the migration
// (atlasShapeSvg.ts, AtlasShapeLivePreview.tsx, useAtlasShapeCreate.ts,
// useAtlasDragTools.ts) don't each need an import-path edit for one
// rename.
export { SHAPE_STROKE_WIDTHS, useAtlasShapeStyle, type AtlasShapeType } from './atlasStyleValueStore'
