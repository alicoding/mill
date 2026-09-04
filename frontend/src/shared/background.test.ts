import { afterEach, describe, expect, it, vi } from 'vitest'
import { background, useBackgroundFailureStore } from './background'

// goal 0313: background() is the escape hatch for a promise no
// user-initiated command started (shared/commands.ts's runCommand is
// that door) -- a poll, a refresh, a fire-and-forget window/badge
// call. It never re-throws; a rejection is tagged and counted instead.
describe('background (goal 0313)', () => {
  afterEach(() => {
    useBackgroundFailureStore.setState({ failures: {} })
    vi.restoreAllMocks()
  })

  it('a resolving promise leaves no failure recorded', async () => {
    await background(Promise.resolve('ok'), 'test.resolves')
    expect(useBackgroundFailureStore.getState().failures['test.resolves']).toBeUndefined()
  })

  it('a rejecting promise increments the failure counter for its source and warns once, tagged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await background(Promise.reject(new Error('boom')), 'test.rejects')
    expect(useBackgroundFailureStore.getState().failures['test.rejects']).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('test.rejects')
  })

  it('two rejections against the same source accumulate under that one key', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await background(Promise.reject(new Error('one')), 'test.repeat')
    await background(Promise.reject(new Error('two')), 'test.repeat')
    expect(useBackgroundFailureStore.getState().failures['test.repeat']).toBe(2)
  })

  it('never rejects itself -- the returned promise always resolves, even on failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(background(Promise.reject(new Error('boom')), 'test.settles')).resolves.toBeUndefined()
  })
})
