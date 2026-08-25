import { create } from 'zustand'

// The style surface's one generic value store (goal 0209): every
// noun's CURRENT style choices, keyed by noun id then field key --
// replaces the pre-0209 atlasShapeStyleStore.ts/atlasPencilStyleStore.ts
// pair of separately-declared stores with one shape a THIRD noun costs
// nothing to join. Seeds the NEXT placed instance; an ALREADY-placed
// instance's own style instead lives in its BoardObject.Payload
// (shapeTool.commit/pencilTool.commit), which IS persisted document
// data -- this store is never read back from there. Deliberately
// in-memory only -- no persist middleware, no backend call, nothing
// written through AtlasService -- so quitting Mill loses it and a
// fresh session starts back at INITIAL_VALUES rather than resurrecting
// a prior session's choice as if it were saved content.
export type AtlasStyleValue = string | number

export const PENCIL_COLORS = ['#1f6feb', '#da3633', '#238636', '#9a6700', '#8250df', '#24292f']
export const PENCIL_SIZES = [2, 4, 8] as const
export const SHAPE_STROKE_WIDTHS = [1, 2, 4] as const
export type AtlasShapeType = 'rectangle' | 'ellipse' | 'arrow'

const INITIAL_VALUES: Record<string, Record<string, AtlasStyleValue>> = {
  shape: { shapeType: 'rectangle', stroke: PENCIL_COLORS[0], strokeWidth: SHAPE_STROKE_WIDTHS[1], fill: 'none' },
  pencil: { color: PENCIL_COLORS[0], size: PENCIL_SIZES[1] },
}

interface AtlasStyleValueState {
  values: Record<string, Record<string, AtlasStyleValue>>
  setValue: (nounId: string, key: string, value: AtlasStyleValue) => void
}

// Exported for atlasStyleValueStore.test.ts's own imperative
// `.getState()`/`.setState()` access -- vitest cannot call a React hook
// (this store's own `use...` consumers below) outside a component
// render, so the unit test drives the underlying zustand store
// directly, the same imperative escape hatch zustand's own docs
// recommend for non-component tests.
export const useAtlasStyleValues = create<AtlasStyleValueState>()((set) => ({
  values: INITIAL_VALUES,
  setValue: (nounId, key, value) =>
    set((s) => ({ values: { ...s.values, [nounId]: { ...s.values[nounId], [key]: value } } })),
}))

// useAtlasNounStyle / useAtlasSetStyleValue -- the generic read/write
// pair AtlasStylePanel.tsx uses (goal 0211's own conformance test bans
// any noun-id branch in that file): one noun's current values by id,
// and the one setter, with no per-noun name appearing in either.
export function useAtlasNounStyle(nounId: string): Record<string, AtlasStyleValue> {
  return useAtlasStyleValues((s) => s.values[nounId] ?? {})
}

export function useAtlasSetStyleValue(): (nounId: string, key: string, value: AtlasStyleValue) => void {
  return useAtlasStyleValues((s) => s.setValue)
}

// Typed convenience wrappers for the non-picker call sites
// (AtlasBoard.tsx, useAtlasDragTools.ts, useAtlasShapeCreate.ts) that
// want a named shape rather than the generic key/value pair -- backed
// by the SAME store above, never a second source of truth. Also
// re-exported unchanged from atlasShapeStyleStore.ts/
// atlasPencilStyleStore.ts's own thin shims so neither caller needed an
// import-path edit for this migration.
export function useAtlasShapeStyle(): {
  shapeType: AtlasShapeType
  stroke: string
  strokeWidth: number
  fill: string
  setShapeType: (v: AtlasShapeType) => void
  setStroke: (v: string) => void
  setStrokeWidth: (v: number) => void
  setFill: (v: string) => void
} {
  const values = useAtlasNounStyle('shape')
  const setValue = useAtlasSetStyleValue()
  return {
    shapeType: (values.shapeType as AtlasShapeType) ?? 'rectangle',
    stroke: (values.stroke as string) ?? PENCIL_COLORS[0],
    strokeWidth: (values.strokeWidth as number) ?? SHAPE_STROKE_WIDTHS[1],
    fill: (values.fill as string) ?? 'none',
    setShapeType: (v) => setValue('shape', 'shapeType', v),
    setStroke: (v) => setValue('shape', 'stroke', v),
    setStrokeWidth: (v) => setValue('shape', 'strokeWidth', v),
    setFill: (v) => setValue('shape', 'fill', v),
  }
}

export function useAtlasPencilStyle(): {
  color: string
  size: number
  setColor: (v: string) => void
  setSize: (v: number) => void
} {
  const values = useAtlasNounStyle('pencil')
  const setValue = useAtlasSetStyleValue()
  return {
    color: (values.color as string) ?? PENCIL_COLORS[0],
    size: (values.size as number) ?? PENCIL_SIZES[1],
    setColor: (v) => setValue('pencil', 'color', v),
    setSize: (v) => setValue('pencil', 'size', v),
  }
}
