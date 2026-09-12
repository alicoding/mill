import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Report } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'

const listAvailability = vi.fn()
vi.mock('./bindings', () => ({ ConfigureService: { ListAIProviderAvailability: (...args: unknown[]) => listAvailability(...args) } }))

import { refreshAIProviderAvailability, useConfigureEntityStore } from './configureEntityStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const report = (providerId: string, checkId: string) => ({ providerId, checkId } as Report)

describe('AI provider availability cache', () => {
  beforeEach(() => {
    listAvailability.mockReset()
    useConfigureEntityStore.setState({ aiProviderAvailability: {} })
  })

  it('keeps a late older response from replacing the newest evidence', async () => {
    const old = deferred<Report[]>()
    const current = deferred<Report[]>()
    listAvailability.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)

    const oldRefresh = refreshAIProviderAvailability()
    const currentRefresh = refreshAIProviderAvailability()
    current.resolve([report('provider-1', 'new-check')])
    await currentRefresh
    old.resolve([report('provider-1', 'old-check')])
    await oldRefresh

    expect(useConfigureEntityStore.getState().aiProviderAvailability['provider-1'].checkId).toBe('new-check')
  })

  it('removes reports absent from the newest cache-only list', async () => {
    useConfigureEntityStore.setState({ aiProviderAvailability: { removed: report('removed', 'check-1') } })
    listAvailability.mockResolvedValue([])

    await refreshAIProviderAvailability()

    expect(useConfigureEntityStore.getState().aiProviderAvailability).toEqual({})
    expect(listAvailability).toHaveBeenCalledTimes(1)
  })
})
