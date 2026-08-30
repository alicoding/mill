import { describe, expect, it } from 'vitest'

// Regression coverage for goal 0209's generic style-value store,
// re-pointed by goal 0252: the per-noun literals (shape/pencil) left
// with the drawing tools -- every seeded entry now arrives through
// registration (canvasToolAdapter's seedStyleValues), so the store
// itself starts empty. Driven imperatively
// (`useAtlasStyleValues.getState()`), not through the exported hooks
// -- those call into React's own hook machinery and cannot run
// outside a component render.
describe('useAtlasStyleValues', () => {
  it('starts empty -- defaults are seeded at registration, never a literal here', async () => {
    const { useAtlasStyleValues } = await import('./atlasStyleValueStore')
    expect(useAtlasStyleValues.getState().values).toEqual({})
  })

  it('setValue mutates one noun/key in the in-memory cache synchronously, leaving other nouns/keys untouched', async () => {
    const { useAtlasStyleValues } = await import('./atlasStyleValueStore')
    useAtlasStyleValues.getState().setValue('pencil', 'color', '#238636')
    useAtlasStyleValues.getState().setValue('pencil', 'size', 4)
    useAtlasStyleValues.getState().setValue('shape', 'stroke', '#1f6feb')
    expect(useAtlasStyleValues.getState().values.pencil).toEqual({ color: '#238636', size: 4 })

    useAtlasStyleValues.getState().setValue('shape', 'fill', '#da3633')
    expect(useAtlasStyleValues.getState().values.shape).toEqual({ stroke: '#1f6feb', fill: '#da3633' })
    expect(useAtlasStyleValues.getState().values.pencil.color).toBe('#238636')
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
    firstSession.getState().setValue('pencil', 'color', '#8250df')
    expect(firstSession.getState().values.pencil.color).toBe('#8250df')

    await import('vitest').then(({ vi }) => vi.resetModules())
    const { useAtlasStyleValues: freshSession } = await import('./atlasStyleValueStore')
    expect(freshSession.getState().values.pencil).toBeUndefined()
  })
})
