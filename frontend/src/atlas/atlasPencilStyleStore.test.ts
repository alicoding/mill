import { describe, expect, it } from 'vitest'
import { PENCIL_COLORS, PENCIL_SIZES } from './atlasPencilStyleStore'

describe('useAtlasPencilStyle', () => {
  it('starts at the built-in default colour/size', async () => {
    const { useAtlasPencilStyle } = await import('./atlasPencilStyleStore')
    const state = useAtlasPencilStyle.getState()
    expect(state.color).toBe(PENCIL_COLORS[0])
    expect(state.size).toBe(PENCIL_SIZES[1])
  })

  it('setColor/setSize mutate the in-memory cache synchronously, with no backend/persistence call', async () => {
    const { useAtlasPencilStyle } = await import('./atlasPencilStyleStore')
    useAtlasPencilStyle.getState().setColor(PENCIL_COLORS[2])
    useAtlasPencilStyle.getState().setSize(PENCIL_SIZES[2])
    expect(useAtlasPencilStyle.getState().color).toBe(PENCIL_COLORS[2])
    expect(useAtlasPencilStyle.getState().size).toBe(PENCIL_SIZES[2])
  })

  // The styleDefaults dual model's ephemeral half (goal 0169 slice 3):
  // a fresh module instance -- standing in for a fresh Mill process,
  // since this store carries no persist middleware and no write
  // through any backend service -- never sees a prior "session"'s
  // choice. This is the mechanism that keeps the cache out of document
  // data: there is nothing here FOR a reload to read back.
  it('never resurrects a prior session\'s choice in a fresh module instance', async () => {
    const { useAtlasPencilStyle: firstSession } = await import('./atlasPencilStyleStore')
    firstSession.getState().setColor(PENCIL_COLORS[3])
    firstSession.getState().setSize(PENCIL_SIZES[0])
    expect(firstSession.getState().color).toBe(PENCIL_COLORS[3])

    await import('vitest').then(({ vi }) => vi.resetModules())
    const { useAtlasPencilStyle: freshSession } = await import('./atlasPencilStyleStore')
    expect(freshSession.getState().color).toBe(PENCIL_COLORS[0])
    expect(freshSession.getState().size).toBe(PENCIL_SIZES[1])
  })
})
