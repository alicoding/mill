import { describe, expect, it } from 'vitest'
import { PENCIL_COLORS, PENCIL_SIZES, SHAPE_STROKE_WIDTHS } from './atlasStyleValueStore'

// Regression coverage for goal 0209's own migration: the pre-existing
// atlasPencilStyleStore.ts unit test drove a bespoke zustand store's
// own `.getState()`; that store is now a thin re-export shim over the
// one generic store this file tests instead. Driven imperatively
// (`useAtlasStyleValues.getState()`), not through the exported
// `useAtlasNounStyle`/`useAtlasShapeStyle`/`useAtlasPencilStyle` hooks
// -- those call into React's own hook machinery and cannot run outside
// a component render.
describe('useAtlasStyleValues', () => {
  it('starts at the built-in per-noun defaults', async () => {
    const { useAtlasStyleValues } = await import('./atlasStyleValueStore')
    const state = useAtlasStyleValues.getState()
    expect(state.values.shape).toEqual({ shapeType: 'rectangle', stroke: PENCIL_COLORS[0], strokeWidth: SHAPE_STROKE_WIDTHS[1], fill: 'none' })
    expect(state.values.pencil).toEqual({ color: PENCIL_COLORS[0], size: PENCIL_SIZES[1] })
  })

  it('setValue mutates one noun/key in the in-memory cache synchronously, leaving other nouns/keys untouched', async () => {
    const { useAtlasStyleValues } = await import('./atlasStyleValueStore')
    useAtlasStyleValues.getState().setValue('pencil', 'color', PENCIL_COLORS[2])
    expect(useAtlasStyleValues.getState().values.pencil.color).toBe(PENCIL_COLORS[2])
    expect(useAtlasStyleValues.getState().values.pencil.size).toBe(PENCIL_SIZES[1])
    expect(useAtlasStyleValues.getState().values.shape.stroke).toBe(PENCIL_COLORS[0])

    useAtlasStyleValues.getState().setValue('shape', 'fill', PENCIL_COLORS[1])
    expect(useAtlasStyleValues.getState().values.shape.fill).toBe(PENCIL_COLORS[1])
    expect(useAtlasStyleValues.getState().values.shape.shapeType).toBe('rectangle')
  })

  // The styleDefaults dual model's ephemeral half (goal 0169 slice 3,
  // carried forward by goal 0209's migration): a fresh module instance
  // -- standing in for a fresh Mill process, since this store carries
  // no persist middleware and no write through any backend service --
  // never sees a prior "session"'s choice. This is the mechanism that
  // keeps the cache out of document data: there is nothing here for a
  // reload to read back.
  it('never resurrects a prior session\'s choice in a fresh module instance', async () => {
    const { useAtlasStyleValues: firstSession } = await import('./atlasStyleValueStore')
    firstSession.getState().setValue('pencil', 'color', PENCIL_COLORS[3])
    expect(firstSession.getState().values.pencil.color).toBe(PENCIL_COLORS[3])

    await import('vitest').then(({ vi }) => vi.resetModules())
    const { useAtlasStyleValues: freshSession } = await import('./atlasStyleValueStore')
    expect(freshSession.getState().values.pencil.color).toBe(PENCIL_COLORS[0])
  })
})
